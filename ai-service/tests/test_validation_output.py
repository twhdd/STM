import json
import math
from pathlib import Path
import tempfile
import unittest

from traffic_vision.metrics import Detection, VideoMetrics
from traffic_vision.output import SCHEMA_VERSION, build_document, write_json
from traffic_vision.validation import (
    VisionError,
    make_counting_line,
    validate_confidence,
    validate_device,
    validate_options,
    validate_paths,
)


class ValidationTests(unittest.TestCase):
    def test_confidence_and_device_validation(self):
        self.assertEqual(validate_confidence(0.5), 0.5)
        for invalid in (-0.1, 1.1, math.nan, math.inf):
            with self.subTest(invalid=invalid), self.assertRaises(VisionError):
                validate_confidence(invalid)
        self.assertEqual(validate_device("auto"), "auto")
        self.assertEqual(validate_device("CPU"), "cpu")
        self.assertEqual(validate_device("0"), "0")
        with self.assertRaises(VisionError):
            validate_device("cuda")

    def test_counting_line_validation_and_tracking_requirement(self):
        self.assertEqual(
            make_counting_line([1, 2, 10, 2]),
            {"x1": 1.0, "y1": 2.0, "x2": 10.0, "y2": 2.0},
        )
        for line in ([1, 2, 1, 2], [-1, 0, 1, 1], [0, 1, math.nan, 2]):
            with self.subTest(line=line), self.assertRaises(VisionError):
                make_counting_line(line)
        with self.assertRaises(VisionError):
            validate_options(make_counting_line([0, 0, 1, 1]), False, 30)

    def test_input_and_weight_files_must_exist_and_outputs_cannot_clobber(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "video.mp4"
            weights = root / "model.pt"
            video.touch()
            weights.touch()
            resolved = validate_paths(video, weights, root / "result.json")
            self.assertEqual(resolved[0], video.resolve())
            with self.assertRaises(VisionError):
                validate_paths(root / "missing.mp4", weights, root / "result.json")
            with self.assertRaises(VisionError):
                validate_paths(video, weights, video)
            with self.assertRaises(VisionError):
                validate_paths(video, weights, root / "result.json", root / "result.json")

    def test_detection_rejects_invalid_values(self):
        with self.assertRaises(ValueError):
            Detection("car", 1.5, (0, 0, 5, 5))
        with self.assertRaises(ValueError):
            Detection("car", 0.9, (5, 0, 1, 5))


class OutputTests(unittest.TestCase):
    def test_json_serialization_is_versioned_and_preserves_frame_data(self):
        metrics = VideoMetrics(tracking=True)
        metrics.add_frame(
            0,
            0,
            [Detection("car", 0.875, (1, 2, 10, 12), track_id=7)],
        )
        document = build_document(
            {"fileName": "traffic.mp4", "width": 640, "height": 480},
            {"trackingEnabled": True},
            metrics.result(0.5),
        )

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "result.json"
            write_json(document, path)
            loaded = json.loads(path.read_text(encoding="utf-8"))

        self.assertEqual(loaded["schemaVersion"], SCHEMA_VERSION)
        self.assertEqual(loaded["frames"][0]["frameIndex"], 0)
        self.assertEqual(loaded["frames"][0]["timestampMs"], 0)
        self.assertEqual(
            loaded["frames"][0]["detections"][0],
            {
                "class": "car",
                "confidence": 0.875,
                "bbox": [1.0, 2.0, 10.0, 12.0],
                "trackId": 7,
            },
        )


if __name__ == "__main__":
    unittest.main()
