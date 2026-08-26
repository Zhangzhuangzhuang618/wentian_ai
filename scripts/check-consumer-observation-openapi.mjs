import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONSUMER_OBSERVATION_API_ROUTES,
  CONSUMER_OBSERVATION_HTTP_CONTRACT_VERSION,
  claimConsumerObservationTaskResponseSchema,
  confirmConsumerObservationHttpInputSchema,
  confirmConsumerObservationResponseSchema,
  consumerObservationRunSummarySchema,
  consumerObservationTaskSummarySchema,
  consumerSessionConditionsSchema,
  createConsumerObservationInputSchema,
  createConsumerObservationResponseSchema,
  rejectConsumerObservationHttpInputSchema,
  rejectConsumerObservationResponseSchema,
  submitConsumerCaptureMultipartMetadataSchema,
  submitConsumerCaptureResponseSchema,
  visibleCitationInputSchema,
  visibleObservationMetadataSchema,
} from "../packages/contracts/src/index.ts";

const projectRoot = path.resolve(import.meta.dirname, "..");
const defaultDocumentPath = path.join(
  projectRoot,
  "docs/openapi/wentian-consumer-observation.openapi.json",
);

const operationContracts = Object.freeze({
  create: {
    operationId: "createConsumerObservation",
    requestMediaType: "application/json",
    requestSchema: "CreateConsumerObservationRequest",
    responseStatus: "201",
    responseSchema: "CreateConsumerObservationResponse",
  },
  claim: {
    operationId: "claimConsumerObservationTask",
    responseStatus: "200",
    responseSchema: "ClaimConsumerObservationTaskResponse",
  },
  captures: {
    operationId: "submitConsumerObservationCapture",
    requestMediaType: "multipart/form-data",
    responseStatus: "202",
    responseSchema: "SubmitConsumerCaptureResponse",
    requiredParameter: "#/components/parameters/CaptureToken",
  },
  confirm: {
    operationId: "confirmConsumerObservation",
    requestMediaType: "application/json",
    requestSchema: "ConfirmConsumerObservationRequest",
    responseStatus: "200",
    responseSchema: "ConfirmConsumerObservationResponse",
    requiredParameter: "#/components/parameters/IdempotencyKey",
  },
  reject: {
    operationId: "rejectConsumerObservation",
    requestMediaType: "application/json",
    requestSchema: "RejectConsumerObservationRequest",
    responseStatus: "200",
    responseSchema: "RejectConsumerObservationResponse",
    requiredParameter: "#/components/parameters/IdempotencyKey",
  },
});

const schemaContracts = Object.freeze({
  ConsumerSessionConditions: consumerSessionConditionsSchema,
  CreateConsumerObservationRequest: createConsumerObservationInputSchema,
  ConsumerObservationRunSummary: consumerObservationRunSummarySchema,
  ConsumerObservationTaskSummary: consumerObservationTaskSummarySchema,
  CreateConsumerObservationResponse: createConsumerObservationResponseSchema,
  ClaimConsumerObservationTaskResponse:
    claimConsumerObservationTaskResponseSchema,
  VisibleCitation: visibleCitationInputSchema,
  VisibleObservationMetadata: visibleObservationMetadataSchema,
  CaptureSubmissionMetadata: submitConsumerCaptureMultipartMetadataSchema,
  SubmitConsumerCaptureResponse: submitConsumerCaptureResponseSchema,
  ConfirmConsumerObservationRequest: confirmConsumerObservationHttpInputSchema,
  ConfirmConsumerObservationResponse: confirmConsumerObservationResponseSchema,
  RejectConsumerObservationRequest: rejectConsumerObservationHttpInputSchema,
  RejectConsumerObservationResponse: rejectConsumerObservationResponseSchema,
});

export function validateConsumerObservationOpenApiDraft(document) {
  const failures = [];
  const root = asRecord(document);
  if (!root) {
    return ["OpenAPI document must be a JSON object."];
  }

  expectEqual(failures, "openapi", root.openapi, "3.1.0");
  const info = asRecord(root.info);
  expectEqual(
    failures,
    "info.version",
    info?.version,
    CONSUMER_OBSERVATION_HTTP_CONTRACT_VERSION,
  );
  expectEqual(
    failures,
    "x-wentian-contract-version",
    root["x-wentian-contract-version"],
    CONSUMER_OBSERVATION_HTTP_CONTRACT_VERSION,
  );
  expectEqual(
    failures,
    "x-wentian-executable",
    root["x-wentian-executable"],
    false,
  );
  expectEqual(
    failures,
    "x-wentian-production-enabled",
    root["x-wentian-production-enabled"],
    false,
  );
  if (Object.hasOwn(root, "servers")) {
    failures.push("servers must be absent from the non-executable draft.");
  }

  const paths = asRecord(root.paths);
  if (!paths) {
    failures.push("paths must be an object.");
  } else {
    expectStringSet(
      failures,
      "paths",
      Object.keys(paths),
      Object.values(CONSUMER_OBSERVATION_API_ROUTES),
    );
    validateOperations(failures, paths);
  }

  const components = asRecord(root.components);
  const schemas = asRecord(components?.schemas);
  if (!schemas) {
    failures.push("components.schemas must be an object.");
  } else {
    validateSchemaParity(failures, schemas);
  }
  validateParameters(failures, asRecord(components?.parameters));

  return failures;
}

function validateOperations(failures, paths) {
  for (const [routeName, routePath] of Object.entries(
    CONSUMER_OBSERVATION_API_ROUTES,
  )) {
    const pathItem = asRecord(paths[routePath]);
    if (!pathItem) {
      continue;
    }
    const disallowedMethods = Object.keys(pathItem).filter((key) =>
      ["get", "put", "patch", "delete", "options", "head", "trace"].includes(
        key,
      ),
    );
    if (disallowedMethods.length > 0) {
      failures.push(`${routePath} only permits POST in this draft.`);
    }

    if (routeName !== "create") {
      expectReferenceInArray(
        failures,
        `${routePath}.parameters`,
        pathItem.parameters,
        "#/components/parameters/TaskId",
      );
    }

    const operation = asRecord(pathItem.post);
    if (!operation) {
      failures.push(`${routePath}.post must be an object.`);
      continue;
    }
    const contract = operationContracts[routeName];
    expectEqual(
      failures,
      `${routePath}.post.operationId`,
      operation.operationId,
      contract.operationId,
    );
    expectEqual(
      failures,
      `${routePath}.post.x-wentian-executable`,
      operation["x-wentian-executable"],
      false,
    );

    if (contract.requiredParameter) {
      expectReferenceInArray(
        failures,
        `${routePath}.post.parameters`,
        operation.parameters,
        contract.requiredParameter,
      );
    }

    if (contract.requestMediaType === "multipart/form-data") {
      validateCaptureMultipart(failures, routePath, operation);
    } else if (contract.requestMediaType) {
      expectSchemaReference(
        failures,
        `${routePath}.post.requestBody`,
        asRecord(
          asRecord(asRecord(operation.requestBody)?.content)?.[
            contract.requestMediaType
          ],
        )?.schema,
        contract.requestSchema,
      );
      expectEqual(
        failures,
        `${routePath}.post.requestBody.required`,
        asRecord(operation.requestBody)?.required,
        true,
      );
    } else if (Object.hasOwn(operation, "requestBody")) {
      failures.push(`${routePath}.post.requestBody must be absent.`);
    }

    const response = asRecord(
      asRecord(operation.responses)?.[contract.responseStatus],
    );
    expectSchemaReference(
      failures,
      `${routePath}.post.responses.${contract.responseStatus}`,
      asRecord(asRecord(response?.content)?.["application/json"])?.schema,
      contract.responseSchema,
    );
  }
}

function validateCaptureMultipart(failures, routePath, operation) {
  const requestBody = asRecord(operation.requestBody);
  expectEqual(
    failures,
    `${routePath}.post.requestBody.required`,
    requestBody?.required,
    true,
  );
  const multipart = asRecord(
    asRecord(requestBody?.content)?.["multipart/form-data"],
  );
  const schema = asRecord(multipart?.schema);
  expectEqual(
    failures,
    `${routePath}.multipart.additionalProperties`,
    schema?.additionalProperties,
    false,
  );
  expectStringSet(
    failures,
    `${routePath}.multipart.required`,
    asStringArray(schema?.required),
    ["metadata", "screenshot"],
  );
  const properties = asRecord(schema?.properties);
  expectStringSet(
    failures,
    `${routePath}.multipart.properties`,
    properties ? Object.keys(properties) : [],
    ["metadata", "screenshot", "sanitized_dom"],
  );
  expectSchemaReference(
    failures,
    `${routePath}.multipart.metadata`,
    properties?.metadata,
    "CaptureSubmissionMetadata",
  );
  const screenshot = asRecord(properties?.screenshot);
  expectEqual(
    failures,
    `${routePath}.multipart.screenshot.type`,
    screenshot?.type,
    "string",
  );
  expectEqual(
    failures,
    `${routePath}.multipart.screenshot.format`,
    screenshot?.format,
    "binary",
  );
}

function validateSchemaParity(failures, schemas) {
  expectStringSet(
    failures,
    "components.schemas",
    Object.keys(schemas),
    Object.keys(schemaContracts),
  );

  for (const [name, zodSchema] of Object.entries(schemaContracts)) {
    const openApiSchema = asRecord(schemas[name]);
    if (!openApiSchema) {
      continue;
    }
    expectEqual(
      failures,
      `components.schemas.${name}.type`,
      openApiSchema.type,
      "object",
    );
    expectEqual(
      failures,
      `components.schemas.${name}.additionalProperties`,
      openApiSchema.additionalProperties,
      false,
    );
    const properties = asRecord(openApiSchema.properties);
    expectStringSet(
      failures,
      `components.schemas.${name}.properties`,
      properties ? Object.keys(properties) : [],
      Object.keys(zodSchema.shape),
    );
    expectStringSet(
      failures,
      `components.schemas.${name}.required`,
      asStringArray(openApiSchema.required),
      requiredZodKeys(zodSchema),
    );
  }
}

function validateParameters(failures, parameters) {
  if (!parameters) {
    failures.push("components.parameters must be an object.");
    return;
  }
  expectStringSet(failures, "components.parameters", Object.keys(parameters), [
    "TaskId",
    "CaptureToken",
    "IdempotencyKey",
  ]);
  validateParameter(failures, parameters.TaskId, {
    name: "id",
    in: "path",
    format: "uuid",
  });
  validateParameter(failures, parameters.CaptureToken, {
    name: "X-Wentian-Capture-Token",
    in: "header",
    minLength: 1,
    maxLength: 4096,
  });
  validateParameter(failures, parameters.IdempotencyKey, {
    name: "Idempotency-Key",
    in: "header",
    minLength: 1,
    maxLength: 200,
  });
}

function validateParameter(failures, value, expected) {
  const parameter = asRecord(value);
  const label = `components.parameters.${expected.name}`;
  expectEqual(failures, `${label}.name`, parameter?.name, expected.name);
  expectEqual(failures, `${label}.in`, parameter?.in, expected.in);
  expectEqual(failures, `${label}.required`, parameter?.required, true);
  const schema = asRecord(parameter?.schema);
  expectEqual(failures, `${label}.schema.type`, schema?.type, "string");
  for (const key of ["format", "minLength", "maxLength"]) {
    if (Object.hasOwn(expected, key)) {
      expectEqual(
        failures,
        `${label}.schema.${key}`,
        schema?.[key],
        expected[key],
      );
    }
  }
}

function requiredZodKeys(schema) {
  return Object.entries(schema.shape)
    .filter(([, childSchema]) => !childSchema.safeParse(undefined).success)
    .map(([key]) => key);
}

function expectSchemaReference(failures, label, value, schemaName) {
  const record = asRecord(value);
  expectEqual(
    failures,
    `${label} schema reference`,
    record?.$ref,
    `#/components/schemas/${schemaName}`,
  );
}

function expectReferenceInArray(failures, label, value, expectedReference) {
  const references = Array.isArray(value)
    ? value.map((item) => asRecord(item)?.$ref).filter(Boolean)
    : [];
  if (!references.includes(expectedReference)) {
    failures.push(`${label} must include ${expectedReference}.`);
  }
}

function expectStringSet(failures, label, actual, expected) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    failures.push(
      `${label} mismatch: expected ${JSON.stringify(expectedSorted)}, received ${JSON.stringify(actualSorted)}.`,
    );
  }
}

function expectEqual(failures, label, actual, expected) {
  if (actual !== expected) {
    failures.push(
      `${label} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

function asRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function asStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
}

async function run() {
  const inputPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : defaultDocumentPath;
  let document;
  try {
    document = JSON.parse(await readFile(inputPath, "utf8"));
  } catch (error) {
    process.stderr.write(
      `Consumer observation OpenAPI could not be read: ${error.message}\n`,
    );
    process.exitCode = 1;
    return;
  }
  const failures = validateConsumerObservationOpenApiDraft(document);
  if (failures.length > 0) {
    process.stderr.write(
      `Consumer observation OpenAPI drift detected:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    "Consumer observation OpenAPI draft matches routes and Zod contracts.\n",
  );
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await run();
}
