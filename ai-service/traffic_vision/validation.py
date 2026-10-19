from pathlib import Path
import math


SUPPORTED_CLASSES = {
    "car": "car",
    "motorcycle": "motorcycle",
    "motorbike": "motorcycle",
    "bus": "bus",
    "truck": "truck",
}


class VisionError(Exception):
    """An actionable input, configuration, or processing error."""


def validate_confidence(value):
    if not math.isfinite(value) or not 0 <= value <= 1:
        raise VisionError("confidence must be a finite number between 0 and 1")
    return value


def validate_device(value):
    normalized = str(value).strip().lower()
    if normalized in {"auto", "cpu"} or normalized.isdigit():
        return normalized
    raise VisionError("device must be 'auto', 'cpu', or a non-negative GPU index")


def validate_max_track_age(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise VisionError("maximum track age must be a non-negative integer")
    return value


def validate_options(counting_line, tracking, max_track_age):
    validate_max_track_age(max_track_age)
    if counting_line is not None and not tracking:
        raise VisionError("a counting line requires tracking to be enabled")


def validate_paths(input_path, weights_path, output_path, annotated_path=None):
    input_path = Path(input_path).expanduser()
    weights_path = Path(weights_path).expanduser()
    output_path = Path(output_path).expanduser()
    annotated_path = (
        Path(annotated_path).expanduser() if annotated_path is not None else None
    )

    if not input_path.is_file():
        raise VisionError(f"input video does not exist or is not a file: {input_path}")
    if not weights_path.is_file():
        raise VisionError(
            f"local model weights do not exist or are not a file: {weights_path}"
        )

    protected_paths = {input_path.resolve(), weights_path.resolve()}
    requested_outputs = [output_path, annotated_path]
    resolved_outputs = [
        path.resolve() for path in requested_outputs if path is not None
    ]
    if any(path in protected_paths for path in resolved_outputs):
        raise VisionError("output paths must not overwrite the input video or model weights")
    if len(resolved_outputs) != len(set(resolved_outputs)):
        raise VisionError("JSON and annotated-video output paths must be different")

    return input_path.resolve(), weights_path.resolve(), output_path.resolve(), (
        annotated_path.resolve() if annotated_path is not None else None
    )


def make_counting_line(values):
    if values is None:
        return None
    if len(values) != 4 or not all(math.isfinite(value) for value in values):
        raise VisionError("counting line requires four finite pixel coordinates")
    x1, y1, x2, y2 = values
    if min(values) < 0:
        raise VisionError("counting-line coordinates must be non-negative")
    if x1 == x2 and y1 == y2:
        raise VisionError("counting-line endpoints must be different")
    return {
        "x1": float(x1),
        "y1": float(y1),
        "x2": float(x2),
        "y2": float(y2),
    }
