export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class NotImplementedByProvider extends DomainError {
  constructor(provider: string, capability: string) {
    super(
      `${provider} does not implement ${capability}. It is declared, not connected.`,
      "PROVIDER_NOT_IMPLEMENTED",
      501,
    );
  }
}

export class AuthorizationError extends DomainError {
  constructor(message = "Not authorized for this resource") {
    super(message, "NOT_AUTHORIZED", 403);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, "CONFLICT", 409);
  }
}
