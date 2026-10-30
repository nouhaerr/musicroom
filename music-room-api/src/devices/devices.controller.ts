import { PaginationDto } from '../common/pagination.dto';
import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PublicUser } from '../users/user.mapper';
import { DeletedResponse } from '../common/responses';
import { DeviceResponse } from './dto/device.responses';

@ApiTags('devices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  // À appeler une fois au démarrage de l'app mobile. Le `id` retourné doit
  // être renvoyé dans le header `X-Device-Id` sur les appels suivants pour
  // que les logs (V.6) et la délégation de contrôle puissent cibler cet
  // appareil précis.
  @ApiOperation({ summary: 'Register this phone: once, when the app starts' })
  @ApiCreatedResponse({ type: DeviceResponse })
  @Post()
  register(@CurrentUser() user: PublicUser, @Body() dto: RegisterDeviceDto): Promise<DeviceResponse> {
    return this.devicesService.register(user.id, dto);
  }

  @ApiOperation({ summary: 'List the phones registered on your account' })
  @ApiOkResponse({ type: [DeviceResponse] })
  @Get()
  list(@CurrentUser() user: PublicUser, @Query() query: PaginationDto): Promise<DeviceResponse[]> {
    return this.devicesService.listForUser(user.id, query);
  }
  @ApiOperation({ summary: 'Remove a phone from your account' })
  @ApiOkResponse({ type: DeletedResponse })
  @Delete(':id')
  remove(@CurrentUser() user: PublicUser, @Param('id') id: string): Promise<DeletedResponse> {
    return this.devicesService.remove(user.id, id);
  }
}
