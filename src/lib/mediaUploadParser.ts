import busboy from "busboy";
import { Readable, PassThrough } from "node:stream";
import { BadRequestError } from "@/lib/apiHandler";

export interface ParsedMediaUpload {
  clinicId: string;
  fileName: string;
  declaredMimeType: string;
  stream: Readable;
}

/**
 * Streams a multipart/form-data request body without buffering the entire
 * file payload into memory.
 */
export async function parseMultipartUpload(
  request: Request,
): Promise<ParsedMediaUpload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    throw new BadRequestError("Content-Type must be multipart/form-data.");
  }

  if (!request.body) {
    throw new BadRequestError("Missing request body.");
  }

  const url = new URL(request.url);
  let clinicId = url.searchParams.get("clinicId")?.trim() ?? "";

  return new Promise<ParsedMediaUpload>((resolve, reject) => {
    let resolved = false;
    let foundFile = false;

    const bb = busboy({
      headers: { "content-type": contentType },
      limits: {
        files: 1,
      },
    });

    bb.on("field", (name, val) => {
      if (name === "clinicId" && !clinicId) {
        clinicId = val.trim();
      }
    });

    bb.on("file", (fieldname, file, info) => {
      if (foundFile) {
        // Drain any unexpected additional file
        file.resume();
        return;
      }
      foundFile = true;

      const { filename, mimeType } = info;
      const passThrough = new PassThrough();

      // Pipe the incoming file chunk stream into a PassThrough stream
      file.pipe(passThrough);

      // We resolve with the PassThrough stream so downstream can begin processing
      if (!resolved) {
        resolved = true;
        resolve({
          get clinicId() {
            return clinicId;
          },
          fileName: filename,
          declaredMimeType: mimeType,
          stream: passThrough,
        });
      }
    });

    bb.on("error", (err: unknown) => {
      if (!resolved) {
        resolved = true;
        const msg = err instanceof Error ? err.message : String(err);
        reject(new BadRequestError(`Failed to parse multipart request: ${msg}`));
      }
    });

    bb.on("finish", () => {
      if (!foundFile && !resolved) {
        resolved = true;
        reject(new BadRequestError("No file was uploaded."));
      }
    });

    // Stream the web standard request body into busboy
    Readable.fromWeb(request.body as import("node:stream/web").ReadableStream).pipe(bb);
  });
}
