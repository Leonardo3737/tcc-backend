import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { UsuarioRespostaDto } from '../../usuarios/dto/usuario-resposta.dto';
import { UsuariosService } from '../../usuarios/usuarios.service';
import { UsuarioAutenticado } from '../../../common/types/usuario-autenticado';
import { PayloadJwt } from '../dto/resposta-login.dto';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly usuariosService: UsuariosService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.segredo'),
    });
  }

  /**
   * Recarrega o usuario do banco a cada requisicao, em vez de confiar no payload.
   *
   * Custa uma consulta por requisicao e paga por isso em correcao:
   *  - um usuario desativado (ativo = false) perde acesso na hora, sem precisar
   *    esperar o token expirar;
   *  - os perfis vem sempre atuais — um aluno que virou professor nao precisa
   *    relogar, e um perfil removido deixa de valer imediatamente.
   *
   * Um token assinado e prova de AUTENTICACAO, nunca a fonte da AUTORIZACAO.
   */
  async validate(payload: PayloadJwt): Promise<UsuarioAutenticado> {
    const usuario = await this.usuariosService.buscarPorIdComPerfis(payload.sub);

    if (!usuario || !usuario.ativo) {
      throw new UnauthorizedException('Sessao invalida. Faca login novamente.');
    }

    return {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfis: UsuarioRespostaDto.derivarPerfis(usuario.aluno, usuario.professor),
    };
  }
}
