import json
import os
from pathlib import Path
import tempfile

from .validation import VisionError


SCHEMA_VERSION = 1


def build_document(video_metadata, configuration, analyzed):
    return {
        "schemaVersion": SCHEMA_VERSION,
        "video": video_metadata,
        "configuration": configuration,
        "frames": analyzed["frames"],
        "metrics": analyzed["metrics"],
    }


def write_json(document, output_path):
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=output_path.parent,
            prefix=f".{output_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            json.dump(document, temporary_file, indent=2, allow_nan=False)
            temporary_file.write("\n")
        os.replace(temporary_path, output_path)
    except (OSError, TypeError, ValueError) as error:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
        raise VisionError(f"unable to write JSON output '{output_path}': {error}") from error
