import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SteganographyModule } from './steganography.module';
import { SteganographyController } from './steganography.controller';
import { SteganographyService } from './steganography.service';

@Module({
  imports: [SteganographyModule],
  controllers: [AppController, SteganographyController],
  providers: [AppService, SteganographyService],
})
export class AppModule {}
