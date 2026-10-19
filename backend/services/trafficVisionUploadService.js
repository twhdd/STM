const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { VIDEO_TYPES } = require("../config/trafficVision");

class TrafficVisionUploadError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.name = "TrafficVisionUploadError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function describeVideoUpload(headers) {
  const suppliedName = headers["x-file-name"];
  if (typeof suppliedName !== "string" || !suppliedName.trim()) {
    throw new TrafficVisionUploadError(
      "X-File-Name must contain the original video filename",
      400,
      "INVALID_UPLOAD"
    );
  }
  const originalFilename = path.posix.basename(
    suppliedName.replace(/\\/g, "/").trim()
  );
  if (
    !originalFilename ||
    originalFilename.length > 255 ||
    /[\u0000-\u001f\u007f]/.test(originalFilename)
  ) {
    throw new TrafficVisionUploadError(
      "The video filename is invalid",
      400,
      "INVALID_UPLOAD"
    );
  }

  const extension = path.extname(originalFilename).toLowerCase();
  const type = VIDEO_TYPES[extension];
  const mimeType =
    typeof headers["content-type"] === "string"
      ? headers["content-type"].split(";", 1)[0].trim().toLowerCase()
      : "";
  if (!type || !type.mimeTypes.includes(mimeType)) {
    throw new TrafficVisionUploadError(
      "Only supported video extensions with a matching video MIME type are accepted",
      415,
      "UNSUPPORTED_VIDEO_TYPE"
    );
  }

  const contentLength = headers["content-length"];
  if (
    contentLength !== undefined &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) <= 0)
  ) {
    throw new TrafficVisionUploadError(
      "Content-Length must be a positive integer",
      400,
      "INVALID_UPLOAD"
    );
  }

  return {
    originalFilename,
    extension,
    mimeType,
    signature: type.signature,
    expectedBytes:
      contentLength === undefined ? null : Number(contentLength),
  };
}

function hasSupportedSignature(signature, bytes) {
  if (signature === "ftyp") {
    return bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp";
  }
  if (signature === "avi") {
    return (
      bytes.length >= 12 &&
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "AVI "
    );
  }
  return (
    signature === "ebml" &&
    bytes.length >= 4 &&
    bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  );
}

async function writeUploadedVideo(request, destination, descriptor, maxBytes) {
  const declaredLength = descriptor.expectedBytes;
  if (declaredLength !== null && declaredLength > maxBytes) {
    throw new TrafficVisionUploadError(
      "Video exceeds the configured upload size limit",
      413,
      "UPLOAD_TOO_LARGE"
    );
  }

  let bytesWritten = 0;
  let signaturePrefix = Buffer.alloc(0);
  let signatureChecked = false;
  const hash = crypto.createHash("sha256");
  const validator = new Transform({
    transform(chunk, _encoding, callback) {
      bytesWritten += chunk.length;
      if (bytesWritten > maxBytes) {
        callback(
          new TrafficVisionUploadError(
            "Video exceeds the configured upload size limit",
            413,
            "UPLOAD_TOO_LARGE"
          )
        );
        return;
      }
      hash.update(chunk);
      if (!signatureChecked) {
        signaturePrefix = Buffer.concat([signaturePrefix, chunk]).subarray(0, 12);
        if (signaturePrefix.length >= 12) {
          signatureChecked = true;
          if (!hasSupportedSignature(descriptor.signature, signaturePrefix)) {
            callback(
              new TrafficVisionUploadError(
                "Video contents do not match the declared video type",
                415,
                "INVALID_VIDEO_SIGNATURE"
              )
            );
            return;
          }
        }
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (bytesWritten === 0) {
        callback(
          new TrafficVisionUploadError(
            "Uploaded video is empty",
            400,
            "EMPTY_UPLOAD"
          )
        );
        return;
      }
      if (
        !signatureChecked &&
        !hasSupportedSignature(descriptor.signature, signaturePrefix)
      ) {
        callback(
          new TrafficVisionUploadError(
            "Video contents do not match the declared video type",
            415,
            "INVALID_VIDEO_SIGNATURE"
          )
        );
        return;
      }
      callback();
    },
  });

  try {
    await pipeline(
      request,
      validator,
      fs.createWriteStream(destination, { flags: "wx", mode: 0o600 })
    );
  } catch (error) {
    await fs.promises.unlink(destination).catch(() => {});
    if (error instanceof TrafficVisionUploadError) throw error;
    throw new TrafficVisionUploadError(
      "The video upload was interrupted",
      400,
      "UPLOAD_INTERRUPTED"
    );
  }

  if (declaredLength !== null && bytesWritten !== declaredLength) {
    await fs.promises.unlink(destination).catch(() => {});
    throw new TrafficVisionUploadError(
      "Uploaded byte count did not match Content-Length",
      400,
      "UPLOAD_INTERRUPTED"
    );
  }
  return { bytesWritten, sha256: hash.digest("hex") };
}

module.exports = {
  TrafficVisionUploadError,
  describeVideoUpload,
  hasSupportedSignature,
  writeUploadedVideo,
};
