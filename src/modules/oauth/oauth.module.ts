import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { AuthModule } from '../auth/auth.module';
import { OAuthCliente } from './entities/oauth-cliente.model';
import { OAuthCodigo } from './entities/oauth-codigo.model';
import { OAuthRefreshToken } from './entities/oauth-refresh-token.model';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { WellKnownController } from './well-known.controller';

@Module({
  imports: [SequelizeModule.forFeature([OAuthCliente, OAuthCodigo, OAuthRefreshToken]), AuthModule],
  controllers: [OAuthController, WellKnownController],
  providers: [OAuthService],
  exports: [OAuthService],
})
export class OAuthModule {}
