import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const frontendOrigin =
    process.env.FRONTEND_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";

  app.enableCors({
    origin: frontendOrigin.split(",").map((value) => value.trim()),
    credentials: true,
  });
  app.setGlobalPrefix("api");

  const port = Number(process.env.PORT || 4000);
  await app.listen(port);
}

void bootstrap();
