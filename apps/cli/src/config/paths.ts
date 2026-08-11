import { isAbsolute, join } from "node:path";

export type TracePaths = {
  readonly configDirectory: string;
  readonly dataDirectory: string;
  readonly eventQueueDirectory: string;
};

function absoluteEnvironmentPath(
  value: string | undefined,
  fallback: string,
): string {
  const candidate = value?.trim();
  return candidate && isAbsolute(candidate) ? candidate : fallback;
}

export function getTracePaths(
  environment: NodeJS.ProcessEnv = process.env,
): TracePaths {
  const home = environment.HOME?.trim();
  if (!home || !isAbsolute(home)) {
    throw new Error(
      "Trace requires an absolute HOME path to locate its local configuration.",
    );
  }

  const configBase = absoluteEnvironmentPath(
    environment.XDG_CONFIG_HOME,
    join(home, ".config"),
  );
  const dataBase = absoluteEnvironmentPath(
    environment.XDG_DATA_HOME,
    join(home, ".local", "share"),
  );
  const configDirectory = join(configBase, "trace");
  const dataDirectory = join(dataBase, "trace");

  return {
    configDirectory,
    dataDirectory,
    eventQueueDirectory: join(dataDirectory, "events"),
  };
}
