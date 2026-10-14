import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import type * as jwt from 'jsonwebtoken';
import { PassportModule } from '@nestjs/passport';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PerfilGuard } from '../../common/guards/perfil.guard';
import { UsuariosModule } from '../usuarios/usuarios.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RecuperacaoSenha } from './entities/recuperacao-senha.model';
import { Usuario } from '../usuarios/entities/usuario.model';
import { RecuperacaoSenhaController } from './recuperacao-senha.controller';
import { RecuperacaoSenhaService } from './recuperacao-senha.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    UsuariosModule,

    /**
     * `Usuario` entra aqui como MODEL, nao como modulo: a recuperacao de senha
     * precisa escrever `senhaHash` e consumir o codigo na mesma transacao, e
     * atravessar fronteira de service carregando um `transaction` espalharia
     * detalhe de persistencia. Mesmo padrao ja usado em UsuariosModule com
     * MonitoriaParticipante — nao cria ciclo de DI.
     */
    SequelizeModule.forFeature([RecuperacaoSenha, Usuario]),

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
  controllers: [AuthController, RecuperacaoSenhaController],
  providers: [
    AuthService,
    RecuperacaoSenhaService,
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
