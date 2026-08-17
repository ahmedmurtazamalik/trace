const references = process.argv.slice(2);
const immutableImage = /^(?:sha256:[a-f0-9]{64}|[A-Za-z0-9][A-Za-z0-9._/:@-]*@sha256:[a-f0-9]{64})$/;

if (references.length !== 3 || references.some((reference) => !immutableImage.test(reference))) {
  process.stderr.write('TRACE_API_IMAGE, TRACE_MIGRATION_IMAGE, and TRACE_WORKER_IMAGE must be immutable sha256 image IDs or registry digests.\n');
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ event: 'deployment.images.validated', images: references })}\n`);
