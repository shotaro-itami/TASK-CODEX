export class SpecError extends Error {
  constructor(code, target, expected, actual, reference = "TASK-SPEC-001") {
    super(`${code}: ${target}`);
    this.name = "SpecError";
    this.code = code;
    this.target = target;
    this.expected = expected;
    this.actual = actual;
    this.reference = reference;
  }
}
export function assertSpec(condition, code, target, expected, actual, reference) {
  if (!condition) throw new SpecError(code, target, expected, actual, reference);
}

export function printSpecError(error) {
  if (error instanceof SpecError) {
    console.error(error.code);
    console.error(`target: ${error.target}`);
    console.error(`expected: ${error.expected}`);
    console.error(`actual: ${error.actual}`);
    console.error(`reference: ${error.reference}`);
    return;
  }
  console.error("SPEC_UNEXPECTED_ERROR");
  console.error(`target: specification maintenance command`);
  console.error("expected: successful operation");
  console.error(`actual: ${error instanceof Error ? error.message : String(error)}`);
  console.error("reference: TASK-SPEC-001");
}
