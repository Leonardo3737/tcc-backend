import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { UsuarioRespostaDto } from '../usuarios/dto/usuario-resposta.dto';
import { HashService } from '../usuarios/hash.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import { LoginDto } from './dto/login.dto';
import { PayloadJwt, RespostaLoginDto } from './dto/resposta-login.dto';
import { RegistrarAlunoDto } from './dto/registrar-aluno.dto';
import { RegistrarProfessorDto } from './dto/registrar-professor.dto';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usuariosService: UsuariosService,
    private readonly hashService: HashService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * C3 — em producao, cadastro aberto de professor e falha de boot, nao aviso.
   *
   * Com CODIGO_CADASTRO_PROFESSOR vazio, qualquer pessoa se cadastra como
   * PROFESSOR e passa a criar monitorias e habilitar monitores — a RN01 vira
   * decoracao. Um logger.warn em producao rola para fora da tela e ninguem ve.
   * Em desenvolvimento o comportamento permissivo continua, porque ali a
   * conveniencia vale mais e o risco nao existe.
   */
  onModuleInit(): void {
    const ambiente = this.config.get<string>('app.ambiente');
    const codigo = this.config.get<string>('cadastro.codigoProfessor');

    if (ambiente === 'production' && !codigo) {
      throw new Error(
        'CODIGO_CADASTRO_PROFESSOR e obrigatorio em producao: sem ele qualquer pessoa ' +
          'se cadastra como PROFESSOR e pode habilitar monitores (RN01).',
      );
    }

    if (!codigo) {
      this.logger.warn(
        'Cadastro de professor ABERTO (CODIGO_CADASTRO_PROFESSOR vazio). Aceitavel em ' +
          'desenvolvimento; em producao a aplicacao se recusa a subir assim.',
      );
    }
  }

  async registrarAluno(dto: RegistrarAlunoDto): Promise<UsuarioRespostaDto> {
    this.validarDominioDoEmail(dto.email);

    return this.usuariosService.criarAluno({
      nome: dto.nome,
      email: dto.email,
      senhaHash: await this.hashService.gerar(dto.senha),
      matricula: dto.matricula,
      curso: dto.curso ?? null,
    });
  }

  /**
   * Cadastro de professor.
   *
   * Ponto de seguranca deliberado: um PROFESSOR podera, na fase 2, criar
   * monitorias e habilitar monitores (RN01). Se qualquer pessoa puder se
   * cadastrar como professor, RN01 vira decoracao. Por isso o cadastro pode ser
   * fechado com um codigo compartilhado (CODIGO_CADASTRO_PROFESSOR).
   *
   * Em desenvolvimento, sem codigo configurado o cadastro fica aberto. Em
   * producao a aplicacao se recusa a subir nessa condicao (ver onModuleInit).
   */
  async registrarProfessor(dto: RegistrarProfessorDto): Promise<UsuarioRespostaDto> {
    this.validarDominioDoEmail(dto.email);
    this.validarCodigoDeCadastroDeProfessor(dto.codigoCadastro);

    return this.usuariosService.criarProfessor({
      nome: dto.nome,
      email: dto.email,
      senhaHash: await this.hashService.gerar(dto.senha),
      identificacaoFuncional: dto.identificacaoFuncional ?? null,
      departamento: dto.departamento ?? null,
    });
  }

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

  /** D-09: restringe o cadastro a dominios institucionais, se configurado. */
  private validarDominioDoEmail(email: string): void {
    const permitidos = this.config.get<string[]>('cadastro.dominiosPermitidos') ?? [];

    if (permitidos.length === 0) {
      return;
    }

    const dominio = email.split('@')[1]?.toLowerCase() ?? '';

    if (!permitidos.includes(dominio)) {
      throw new BadRequestException(
        `Cadastro permitido apenas para e-mails institucionais: ${permitidos.join(', ')}.`,
      );
    }
  }

  private validarCodigoDeCadastroDeProfessor(codigoInformado?: string): void {
    const codigoEsperado = this.config.get<string>('cadastro.codigoProfessor');

    // O aviso ficou no boot (onModuleInit); repeti-lo a cada requisicao so
    // encheria o log sem informar nada novo.
    if (!codigoEsperado) {
      return;
    }

    if (codigoInformado !== codigoEsperado) {
      throw new ForbiddenException('Codigo de cadastro de professor invalido ou ausente.');
    }
  }
}
