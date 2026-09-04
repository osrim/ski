export const USAGE_ERROR = "UsageError";

export const usageError = (message: string): Error => {
  const error = new Error(message);
  error.name = USAGE_ERROR;
  return error;
};
