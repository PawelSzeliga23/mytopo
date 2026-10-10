"""Depth queue: the API adds a depth_job when a photo arrives, `topo depth-worker` computes the jobs one by one."""

import time
from collections.abc import Callable
from contextlib import AbstractContextManager
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from topo.depth import DepthEstimator, Segmenter, process_wall
from topo.models import DepthJob, Wall

ERROR_MAX = 2000


def enqueue_depth(session: Session, wall_id: int) -> None:
    """Adds a job unless one is already waiting for this wall; no commit — part of the caller's change."""
    waiting = session.scalar(
        select(DepthJob.id).where(DepthJob.wall_id == wall_id, DepthJob.status == "queued").limit(1)
    )
    if waiting is None:
        session.add(DepthJob(wall_id=wall_id, status="queued"))


def requeue_running(session: Session) -> int:
    """Jobs left "running" by a worker that died go back to the queue."""
    count = session.execute(update(DepthJob).where(DepthJob.status == "running").values(status="queued")).rowcount
    session.commit()
    return count


def claim_job(session: Session) -> DepthJob | None:
    """The oldest waiting job, marked "running"; another worker skips it (SKIP LOCKED)."""
    job = session.scalars(
        select(DepthJob)
        .where(DepthJob.status == "queued")
        .order_by(DepthJob.created_at, DepthJob.id)
        .limit(1)
        .with_for_update(skip_locked=True)
    ).first()
    if job is None:
        session.rollback()
        return None
    job.status = "running"
    session.commit()
    return job


def run_job(session: Session, job: DepthJob, media_root: Path, estimator: DepthEstimator, segmenter: Segmenter) -> None:
    """Computes depth and segmentation of the wall's current photo; a photo with ready depth is left as it is."""
    job_id, wall_id = job.id, job.wall_id
    # Deleting the wall meanwhile deletes the job row too (ON DELETE CASCADE): the job is detached and its result
    # written with a plain UPDATE, which then simply matches nothing.
    if job in session:
        session.expunge(job)
    wall = session.get(Wall, wall_id)
    try:
        if wall is not None and wall.image_path is not None:
            process_wall(session, wall, media_root, estimator, segmenter)
    except Exception as exc:
        session.rollback()  # process_wall has already marked the wall failed and committed that
        status, error = "failed", str(exc)[:ERROR_MAX] or type(exc).__name__
    else:
        status, error = "done", None
    session.execute(
        update(DepthJob).where(DepthJob.id == job_id).values(status=status, error=error, model=estimator.name)
    )
    session.commit()
    job.status, job.error, job.model = status, error, estimator.name


def work(
    session_factory: Callable[[], AbstractContextManager[Session]],
    media_root: Path,
    estimator: DepthEstimator,
    segmenter: Segmenter,
    *,
    interval: float = 5.0,
    should_stop: Callable[[], bool] = lambda: False,
    sleep: Callable[[float], object] = time.sleep,
    log: Callable[[str], None] = print,
) -> None:
    """Takes jobs until ``should_stop``; with an empty queue waits ``interval`` seconds."""
    with session_factory() as session:
        if requeued := requeue_running(session):
            log(f"Wznowiono przerwane zadania: {requeued}")
    while not should_stop():
        with session_factory() as session:
            job = claim_job(session)
            if job is None:
                sleep(interval)
                continue
            started = time.perf_counter()
            run_job(session, job, media_root, estimator, segmenter)
            note = f": {job.error}" if job.error else ""
            log(f"Ściana #{job.wall_id}: {job.status} ({time.perf_counter() - started:.1f} s){note}")
