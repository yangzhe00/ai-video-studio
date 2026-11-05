import { configFromEnv } from "./config.ts";
import { createApi } from "./server.ts";

const config = configFromEnv();
(await createApi(config)).listen(config.port, process.env.API_BIND_HOST || "0.0.0.0", () => {
  process.stdout.write(`AI Video Studio API listening on ${config.port}\n`);
});
