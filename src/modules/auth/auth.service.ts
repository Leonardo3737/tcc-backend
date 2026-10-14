import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { UsuarioRespostaDto } from '../usuarios/dto/usuario-resposta.dto';
import { HashService } from '../usuarios/hash.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import { LoginDto } from './dto/login.dto';
import { PayloadJwt, RespostaLoginDto } from './dto/resposta-login.dto';

/**
 * Autenticacao, e nada mais.
 *
 * Nao ha registro aqui. Criar usuario e atribuicao de professor autenticado
 * (UsuariosService.criarAlunoComoProfessor / criarProfessorComoProfessor), o que
 * elimina a necessidade do antigo CODIGO_CADASTRO_PROFESSOR: ele era a unica
 * barreira do auto-cadastro publico, e o auto-cadastro deixou de existir.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly usuariosService: UsuariosService,
    private readonly hashService: HashService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto): Promise<RespostaLoginDto> {
    const usuario = await this.usuariosService.buscarPorEmailComSenha(dto.email);

    /**
     * A senha e conferida mesmo quando o usuario nao existe, com um hash
     * descartavel, para que o tempo de resposta nao denuncie quais e-mails estao
     * cadastrados (enumeracao de usuarios por timing). A mensagem devolvida
     * tambem e identica nos dois casos.
     */
    if (!usuario) {
      await this.hashService.gastarTempoDeVerificacao(dto.senha);
      throw new UnauthorizedException('Credenciais invalidas.');
    }

    const senhaConfere = await this.hashService.conferir(usuario.senhaHash, dto.senha);

    if (!senhaConfere) {
      throw new UnauthorizedException('Credenciais invalidas.');
    }

    if (!usuario.ativo) {
      throw new ForbiddenException('Usuario desativado. Procure a coordenacao.');
    }

    const dadosUsuario = UsuarioRespostaDto.deModelo(usuario);

    const payload: PayloadJwt = {
      sub: usuario.id,
      email: usuario.email,
      perfis: dadosUsuario.perfis,
    };

    const tokenDeAcesso = await this.jwtService.signAsync(payload);

    /**
     * A expiracao e lida de VOLTA do token assinado, em vez de recalculada a
     * partir de JWT_EXPIRES_IN.
     *
     * Sao duas fontes que podem divergir: se a configuracao mudar entre a
     * assinatura e a resposta, ou se o formato for interpretado de outro jeito,
     * o cliente encerraria a sessao na hora errada. O claim `exp` e o unico dado
     * que o proprio verificador vai usar depois.
     */
    const { exp } = this.jwtService.decode<{ exp: number }>(tokenDeAcesso);

    return {
      tokenDeAcesso,
      tipoToken: 'Bearer',
      expiraEm: this.config.getOrThrow<string>('jwt.expiraEm'),
      expiraEmSegundos: Math.max(0, exp - Math.floor(Date.now() / 1000)),
      expiraEmIso: new Date(exp * 1000).toISOString(),
      usuario: dadosUsuario,
    };
  }
}
