import fs from "node:fs";
import { Readable } from "node:stream";
import { prisma } from "@/lib/prisma";
import {
  buildContentDispositionHeader,
  verifyMediaToken,
} from "@/lib/mediaSecurity";
import { resolveSafeStoragePath } from "@/lib/mediaStorage";

export const dynamic = "force-dynamic";

interface RouteProps {
  params: Promise<{ id: string; token: string; filename: string }>;
}

async function handleDocumentRequest(
  request: Request,
  props: RouteProps,
  isHead: boolean,
): Promise<Response> {
  const { id, token } = await props.params;

  if (!token) {
    return new Response("Unauthorized: missing token.", { status: 401 });
  }

  let payload;
  try {
    payload = verifyMediaToken(token);
  } catch {
    return new Response("Forbidden: invalid or expired token.", { status: 403 });
  }

  // Token must bind to this exact mediaId
  if (payload.mediaId !== id) {
    return new Response("Forbidden: token does not match requested resource.", {
      status: 403,
    });
  }

  if (payload.purpose !== "whatsapp" && payload.purpose !== "preview") {
    return new Response("Forbidden: unsupported token purpose.", { status: 403 });
  }

  const media = await prisma.mediaAsset.findFirst({
    where: {
      id,
      tenantId: payload.tenantId,
      clinicId: payload.clinicId,
      deletedAt: null,
    },
    select: {
      id: true,
      storagePath: true,
      mimeType: true,
      fileSize: true,
      mediaType: true,
      originalFileName: true,
    },
  });

  if (!media) {
    return new Response("Not found.", { status: 404 });
  }

  // Defense in depth: Verify this asset is actually a valid PDF document
  if (media.mediaType !== "DOCUMENT" || media.mimeType !== "application/pdf") {
    return new Response("Not found.", { status: 404 });
  }

  let absPath: string;
  let stat: fs.Stats;
  try {
    absPath = resolveSafeStoragePath(media.storagePath);
    stat = await fs.promises.stat(absPath);
  } catch {
    return new Response("Not found.", { status: 404 });
  }

  const totalSize = stat.size;
  const rangeHeader = request.headers.get("range");
  const contentDisposition = buildContentDispositionHeader(media.originalFileName);

  const commonHeaders: Record<string, string> = {
    "Content-Type": "application/pdf",
    "Content-Disposition": contentDisposition,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=3600",
  };

  // Support Range requests (206 Partial Content)
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match) {
      return new Response("Range Not Satisfiable", {
        status: 416,
        headers: {
          ...commonHeaders,
          "Content-Range": `bytes */${totalSize}`,
        },
      });
    }

    let start = match[1] ? parseInt(match[1], 10) : undefined;
    let end = match[2] ? parseInt(match[2], 10) : undefined;

    if (start === undefined && end !== undefined) {
      start = Math.max(0, totalSize - end);
      end = totalSize - 1;
    } else if (start !== undefined && end === undefined) {
      end = totalSize - 1;
    }

    if (
      start === undefined ||
      end === undefined ||
      start >= totalSize ||
      end >= totalSize ||
      start > end
    ) {
      return new Response("Range Not Satisfiable", {
        status: 416,
        headers: {
          ...commonHeaders,
          "Content-Range": `bytes */${totalSize}`,
        },
      });
    }

    const chunkSize = end - start + 1;
    const partialHeaders: Record<string, string> = {
      ...commonHeaders,
      "Content-Range": `bytes ${start}-${end}/${totalSize}`,
      "Content-Length": String(chunkSize),
    };

    if (isHead) {
      return new Response(null, {
        status: 206,
        headers: partialHeaders,
      });
    }

    const stream = fs.createReadStream(absPath, { start, end });
    const webStream = Readable.toWeb(stream);

    return new Response(webStream as unknown as BodyInit, {
      status: 206,
      headers: partialHeaders,
    });
  }

  // Full content response (200 OK)
  const fullHeaders: Record<string, string> = {
    ...commonHeaders,
    "Content-Length": String(totalSize),
  };

  if (isHead) {
    return new Response(null, {
      status: 200,
      headers: fullHeaders,
    });
  }

  const stream = fs.createReadStream(absPath);
  const webStream = Readable.toWeb(stream);

  return new Response(webStream as unknown as BodyInit, {
    status: 200,
    headers: fullHeaders,
  });
}

export async function GET(request: Request, props: RouteProps) {
  return handleDocumentRequest(request, props, false);
}

export async function HEAD(request: Request, props: RouteProps) {
  return handleDocumentRequest(request, props, true);
}
