import numpy as np
import pytest
from PIL import Image

pytest.importorskip("transformers")
pytestmark = pytest.mark.slow


def test_small_model_on_cpu_gives_depth_map_of_expected_size():
    from topo.depth import HFDepthEstimator, compute_depth

    gradient = np.tile(np.linspace(0, 255, 1600, dtype=np.uint8), (1200, 1))
    image = Image.fromarray(np.stack([gradient, gradient // 2, 255 - gradient], axis=-1))
    estimator = HFDepthEstimator("small", device="cpu")
    depth = compute_depth(image, estimator)

    assert estimator.name == "depth-anything-v2-small"
    assert depth.shape == (576, 768) and depth.dtype == np.uint16
    assert depth.max() > depth.min()
