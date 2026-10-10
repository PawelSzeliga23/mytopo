from PIL import Image
from sqlalchemy import delete, select

from tests import factories as f
from tests.test_depth import FakeEstimator, FakeSegmenter
from topo.depth_queue import claim_job, enqueue_depth, requeue_running, run_job, work
from topo.models import DepthJob, Wall


class Broken:
    name = "broken"

    def predict(self, image):
        raise RuntimeError("model padł")


class _Borrowed:
    """The test session as a context manager that does not close it (work() opens one per job)."""

    def __init__(self, session):
        self.session = session

    def __enter__(self):
        return self.session

    def __exit__(self, *exc):
        return False


def wall_with_photo(session, media_root, number=1):
    crag = f.crag(session, f.area(session, "Dolina"), "Skała")
    wall = f.wall(session, crag)
    relative = f"walls/{wall.id}/{number}/display.webp"
    (media_root / relative).parent.mkdir(parents=True)
    Image.new("RGB", (64, 48), (90, 90, 90)).save(media_root / relative, "WEBP")
    wall.image_path = relative
    session.commit()
    return wall


def jobs(session, wall_id):
    return list(session.scalars(select(DepthJob).where(DepthJob.wall_id == wall_id).order_by(DepthJob.id)))


def test_enqueue_skips_duplicate_queued(session, tmp_path):
    wall = wall_with_photo(session, tmp_path)
    enqueue_depth(session, wall.id)
    session.flush()
    enqueue_depth(session, wall.id)
    session.commit()
    assert [(j.status, j.model) for j in jobs(session, wall.id)] == [("queued", None)]


def test_claim_and_run_job(session, tmp_path):
    wall = wall_with_photo(session, tmp_path)
    enqueue_depth(session, wall.id)
    session.commit()

    job = claim_job(session)
    assert job is not None and job.status == "running"
    assert claim_job(session) is None
    run_job(session, job, tmp_path, FakeEstimator(), FakeSegmenter())

    session.expire_all()
    assert (job.status, job.model, job.error) == ("done", "fake-model", None)
    wall = session.get(Wall, wall.id)
    assert (wall.depth_status, wall.depth_path) == ("ready", f"walls/{wall.id}/1/depth.png")
    assert wall.vegetation_ratio is not None


def test_failed_job(session, tmp_path):
    wall = wall_with_photo(session, tmp_path)
    enqueue_depth(session, wall.id)
    session.commit()
    job = claim_job(session)
    run_job(session, job, tmp_path, Broken(), FakeSegmenter())
    session.expire_all()
    assert job.status == "failed" and "model padł" in job.error
    assert session.get(Wall, wall.id).depth_status == "failed"


def test_ready_photo_is_not_recomputed(session, tmp_path):
    """A job queued for a photo that was reverted to one with ready depth finishes without a model run."""
    wall = wall_with_photo(session, tmp_path)
    wall.depth_status, wall.vegetation_ratio = "ready", 0.0
    enqueue_depth(session, wall.id)
    session.commit()
    job = claim_job(session)
    run_job(session, job, tmp_path, Broken(), FakeSegmenter())
    session.expire_all()
    assert job.status == "done"


# A wall deleted while its job runs: CASCADE removes the row, run_job must still finish without an error.
def test_missing_wall_job_is_done(session, tmp_path):
    job = DepthJob(wall_id=999_999, status="running")
    run_job(session, job, tmp_path, Broken(), FakeSegmenter())
    assert job.status == "done"


def test_requeue_running(session, tmp_path):
    wall = wall_with_photo(session, tmp_path)
    enqueue_depth(session, wall.id)
    session.commit()
    claim_job(session)
    assert requeue_running(session) == 1
    assert [j.status for j in jobs(session, wall.id)] == ["queued"]


def test_work_processes_queue_then_sleeps(session, tmp_path):
    wall = wall_with_photo(session, tmp_path)
    enqueue_depth(session, wall.id)
    session.commit()
    sleeps = []
    work(lambda: _Borrowed(session), tmp_path, FakeEstimator(), FakeSegmenter(), interval=7,
         should_stop=lambda: len(sleeps) >= 1, sleep=sleeps.append, log=lambda _: None)
    assert sleeps == [7]
    assert [j.status for j in jobs(session, wall.id)] == ["done"]


class DeletesWall:
    """Depth model during which someone deletes the wall (its job goes with it, ON DELETE CASCADE)."""

    name = "fake-model"

    def __init__(self, session, wall_id):
        self.session, self.wall_id = session, wall_id

    def predict(self, image):
        self.session.execute(delete(Wall).where(Wall.id == self.wall_id))
        return FakeEstimator().predict(image)


def test_wall_deleted_while_running(session, tmp_path):
    wall = wall_with_photo(session, tmp_path)
    enqueue_depth(session, wall.id)
    session.commit()
    job = claim_job(session)
    run_job(session, job, tmp_path, DeletesWall(session, wall.id), FakeSegmenter())  # must not raise
    assert jobs(session, wall.id) == []
