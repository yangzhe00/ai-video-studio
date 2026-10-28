import { configFromEnv } from "./config.ts";
import { createApi } from "./server.ts";

const config = configFromEnv();
createApi(config).listen(config.port, () => {
  process.stdout.write(`AI Video Studio API listening on ${config.port}\n`);
});
