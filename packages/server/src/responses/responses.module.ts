import { Module } from "@nestjs/common"
import { ResponseWriteService } from "./response-write.service.js"
import { SingleResponseController } from "./single-response.controller.js"

@Module({
  controllers: [SingleResponseController],
  providers: [ResponseWriteService],
})
export class ResponsesModule {}
