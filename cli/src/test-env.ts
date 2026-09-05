export const captureEnv = (...names: string[]): (() => void) => {
  const saved = names.map((name) => [name, process.env[name]] as const);
  return () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
};
