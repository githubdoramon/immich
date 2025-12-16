import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Express } from 'express';
import { tmpdir } from 'node:os';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  AssetFaceCreateDto,
  AssetFaceDeleteDto,
  AssetFaceResponseDto,
  FaceDto,
  FaceIdentifyResponseDto,
  PersonResponseDto,
} from 'src/dtos/person.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { PersonService } from 'src/services/person.service';
import { FileNotEmptyValidator, UUIDParamDto } from 'src/validation';

@ApiTags(ApiTag.Faces)
@Controller('faces')
export class FaceController {
  constructor(private service: PersonService) {}

  @Post()
  @Authenticated({ permission: Permission.FaceCreate })
  @Endpoint({
    summary: 'Create a face',
    description:
      'Create a new face that has not been discovered by facial recognition. The content of the bounding box is considered a face.',
    history: new HistoryBuilder().added('v1').beta('v1').stable('v2'),
  })
  createFace(@Auth() auth: AuthDto, @Body() dto: AssetFaceCreateDto) {
    return this.service.createFace(auth, dto);
  }

  @Get()
  @Authenticated({ permission: Permission.FaceRead })
  @Endpoint({
    summary: 'Retrieve faces for asset',
    description: 'Retrieve all faces belonging to an asset.',
    history: new HistoryBuilder().added('v1').beta('v1').stable('v2'),
  })
  getFaces(@Auth() auth: AuthDto, @Query() dto: FaceDto): Promise<AssetFaceResponseDto[]> {
    return this.service.getFacesById(auth, dto);
  }

  @Post('identify')
  @Authenticated({ permission: Permission.FaceRead })
  @UseInterceptors(FileInterceptor('file', { dest: tmpdir() }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @Endpoint({
    summary: 'Identify people in an uploaded image',
    description: 'Detect faces in an uploaded image and return the best matching people with bounding boxes.',
    history: new HistoryBuilder().added('v2'),
  })
  identifyFaces(
    @Auth() auth: AuthDto,
    @UploadedFile(new ParseFilePipe({ validators: [new FileNotEmptyValidator(['file'])] }))
    file: Express.Multer.File,
  ): Promise<FaceIdentifyResponseDto[]> {
    return this.service.identifyFaces(auth, file);
  }

  @Put(':id')
  @Authenticated({ permission: Permission.FaceUpdate })
  @Endpoint({
    summary: 'Re-assign a face to another person',
    description: 'Re-assign the face provided in the body to the person identified by the id in the path parameter.',
    history: new HistoryBuilder().added('v1').beta('v1').stable('v2'),
  })
  reassignFacesById(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: FaceDto,
  ): Promise<PersonResponseDto> {
    return this.service.reassignFacesById(auth, id, dto);
  }

  @Delete(':id')
  @Authenticated({ permission: Permission.FaceDelete })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete a face',
    description: 'Delete a face identified by the id. Optionally can be force deleted.',
    history: new HistoryBuilder().added('v1').beta('v1').stable('v2'),
  })
  deleteFace(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto, @Body() dto: AssetFaceDeleteDto): Promise<void> {
    return this.service.deleteFace(auth, id, dto);
  }
}
