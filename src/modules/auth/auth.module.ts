import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type * as jwt from 'jsonwebtoken';
import { PassportModule } from '@nestjs/passport';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PerfilGuard } from '../../common/guards/perfil.guard';
import { UsuariosModule } from '../usuarios/usuarios.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    UsuariosModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('jwt.segredo'),
        // `expiresIn` e tipado com o literal StringValue da lib `ms`. O valor
        // vem de env (validado por Joi), entao a asercao e a ponte entre uma
        // string de runtime e um tipo que so existe em tempo de compilacao.
        signOptions: {
          expiresIn: config.getOrThrow<string>('jwt.expiraEm') as jwt.SignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,

    /**
     * Guards GLOBAIS.
     *
     * A ordem importa: JwtAuthGuard autentica e popula request.user; PerfilGuard
     * so entao consegue autorizar. Registrar aqui — e nao rota a rota — e o que
     * cumpre a exigencia de que a seguranca seja do backend: uma rota nova ja
     * nasce protegida, e liberar acesso passa a ser um ato explicito (@Publico).
     */
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PerfilGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
