import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { UsuarioRespostaDto } from '../usuarios/dto/usuario-resposta.dto';
import { Usuario } from '../usuarios/entities/usuario.model';
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
  ) { }

  async login(dto: LoginDto): Promise<RespostaLoginDto> {
    const usuario = await this.validarCredenciais(dto.email, dto.senha);
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

  /**
 * Confere email e senha. Extraido do login para ser usado tambem pela tela
 * de autorizacao OAuth, com as mesmas protecoes (timing e usuario desativado).
 */
  async validarCredenciais(email: string, senha: string): Promise<Usuario> {
    const usuario = await this.usuariosService.buscarPorEmailComSenha(email);

    if (!usuario) {
      await this.hashService.gastarTempoDeVerificacao(senha);
      throw new UnauthorizedException('Credenciais invalidas.');
    }
    if (!(await this.hashService.conferir(usuario.senhaHash, senha))) {
      throw new UnauthorizedException('Credenciais invalidas.');
    }
    if (!usuario.ativo) {
      throw new ForbiddenException('Usuario desativado. Procure a coordenacao.');
    }
    return usuario;
  }

  /**
   * Emite o JWT de acesso a partir do id. Usado pelo OAuth na troca do codigo
   * e no refresh: recarrega o usuario do banco, entao um usuario desativado
   * nao consegue renovar.
   */
  async emitirTokenDeAcesso(usuarioId: string): Promise<{ token: string; expiraEmSegundos: number }> {
    const usuario = await this.usuariosService.buscarPorIdComPerfis(usuarioId);
    if (!usuario || !usuario.ativo) {
      throw new UnauthorizedException('Usuario inexistente ou desativado.');
    }

    const payload: PayloadJwt = {
      sub: usuario.id,
      email: usuario.email,
      perfis: UsuarioRespostaDto.derivarPerfis(usuario.aluno, usuario.professor),
    };
    const token = await this.jwtService.signAsync(payload);
    const { exp } = this.jwtService.decode<{ exp: number }>(token);

    return { token, expiraEmSegundos: Math.max(0, exp - Math.floor(Date.now() / 1000)) };
  }
}
