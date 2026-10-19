import argparse
import math
import sys

from . import __version__
from .runner import run_video
from .validation import VisionError


def build_parser():
    parser = argparse.ArgumentParser(
        description="Detect and optionally track vehicles in a recorded traffic video."
    )
    parser.add_argument("--input", required=True, help="local recorded video path")
    parser.add_argument("--weights", required=True, help="existing local Ultralytics model weights")
    parser.add_argument("--output", required=True, help="versioned JSON output path")
    parser.add_argument(
        "--annotated-video", help="optional path for annotated video output"
    )
    parser.add_argument(
        "--confidence",
        type=float,
        default=0.25,
        help="minimum detection confidence (0-1; default: 0.25)",
    )
    parser.add_argument(
        "--device",
        default="auto",
        help="compute device: auto, cpu, or GPU index such as 0 (default: auto)",
    )
    parser.add_argument(
        "--tracking",
        action="store_true",
        help="enable persistent ByteTrack IDs across frames",
    )
    parser.add_argument(
        "--max-track-age-frames",
        type=int,
        default=30,
        help="report a track active if last seen within this many frames (default: 30)",
    )
    parser.add_argument(
        "--counting-line",
        nargs=4,
        type=float,
        metavar=("X1", "Y1", "X2", "Y2"),
        help="optional directed line in video pixel coordinates; requires --tracking",
    )
    parser.add_argument("--version", action="version", version=__version__)
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    if not math.isfinite(args.confidence):
        parser.error("--confidence must be finite")
    try:
        run_video(
            input_path=args.input,
            weights_path=args.weights,
            output_path=args.output,
            annotated_path=args.annotated_video,
            confidence=args.confidence,
            device=args.device,
            tracking=args.tracking,
            counting_line_values=args.counting_line,
            max_track_age_frames=args.max_track_age_frames,
        )
    except (VisionError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    print(f"Analysis written to {args.output}")
    if args.annotated_video:
        print(f"Annotated video written to {args.annotated_video}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
