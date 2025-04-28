import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('My Nest App API')
    .setDescription('The API description for My Nest App')
    .setVersion('1.0')
    .addTag('cats') // Bạn có thể thêm các tag khác ở đây
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document); // Swagger UI sẽ có tại /api

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
