/** Private subprocess fixture transport, never an HTTP/debug endpoint. */
import "dotenv/config";
import { createPatientPortalFixture } from "./patient-portal-test-fixture";
import { prisma } from "@/lib/prisma";
createPatientPortalFixture()
  .then((f) => process.stdout.write(JSON.stringify(f)))
  .catch(() => {
    process.stderr.write("Disposable portal fixture failed.\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
