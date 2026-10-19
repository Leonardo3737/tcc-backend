import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { randomInt } from 'node:crypto';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { EmailService } from '../email/email.service';
import { Usuario } from '../usuarios/entities/usuario.model';
import { HashService } from '../usuarios/hash.service';
import { ConfirmarRecuperacaoDto, SolicitarRecuperacaoDto } from './dto/recuperacao-senha.dto';
import { RecuperacaoSenha } from './entities/recuperacao-senha.model';

/** Validade do codigo. Curta de proposito: e uma credencial em transito. */
const MINUTOS_DE_VALIDADE = 15;

/**
 * Tentativas erradas por codigo.
 *
 * E este numero, e nao os 6 digitos, que define a resistencia a forca bruta.
 * Com 5 tentativas por codigo, a chance de acerto e 5 em 1.000.000 — e o codigo
 * queima antes de uma sexta tentativa.
 */
const MAX_TENTATIVAS = 5;

/**
 * Mensagem UNICA para toda falha de confirmacao.
 *
 * Codigo errado, expirado, ja usado, inexistente e e-mail que nunca se cadastrou
 * produzem exatamente esta resposta. Distinguir os casos seria util para o
 * usuario legitimo e util demais para quem esta sondando: "codigo expirado"
 * confirma que a conta existe e que alguem pediu recuperacao.
 */
const FALHA_GENERICA = 'Codigo invalido ou expirado. Solicite um novo codigo.';

@Injectable()
export class RecuperacaoSenhaService {
  private readonly logger = new Logger(RecuperacaoSenhaService.name);

  /**
   * Injeta os MODELS, nao o UsuariosService.
   *
   * A troca de senha e o consumo do codigo precisam cair na mesma transacao, e
   * atravessar fronteira de service carregando um `transaction` espalharia
   * detalhe de persistencia por uma API publica. E o mesmo padrao ja usado em
   * UsuariosService com MonitoriaParticipante: import de model, nao de modulo.
   */
  constructor(
    @InjectModel(RecuperacaoSenha) private readonly recuperacaoModel: typeof RecuperacaoSenha,
    @InjectModel(Usuario) private readonly usuarioModel: typeof Usuario,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly hashService: HashService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Pedido de recuperacao. NUNCA revela se o e-mail existe.
   *
   * O retorno e identico para conta existente e inexistente. O CUSTO DOMINANTE
   * tambem: quando o e-mail nao existe, o servico gera um hash descartavel para
   * pagar o mesmo argon2. Sem isso a diferenca seria grosseira — ~1ms contra
   * ~35ms — e a rota viraria um enumerador de contas da instituicao. E a mesma
   * defesa que o login aplica.
   *
   * Nao e tempo constante, e nao adianta fingir que e: o caminho da conta
   * existente ainda escreve no banco (invalidar + inserir), e isso mede ~15ms a
   * mais. Medido: ~35ms para inexistente, ~55ms para existente. O que torna
   * esse residuo pouco util ao atacante e o throttle de 3 requisicoes por
   * minuto — separar duas medias com essa diferenca sob ruido de rede exige
   * muitas amostras, e ele tem tres por minuto.
   *
   * O envio do e-mail NAO e aguardado, por duas razoes: o tempo de resposta
   * deixa de depender do provedor (que varia e voltaria a diferenciar os casos),
   * e o usuario nao espera uma chamada de rede externa para ver a tela seguinte.
   * `EmailService.enviar` nunca lanca, entao nao ha promessa rejeitada solta.
   */
  async solicitar(dto: SolicitarRecuperacaoDto): Promise<void> {
    const usuario = await this.usuarioModel.findOne({ where: { email: dto.email } });

    if (!usuario || !usuario.ativo) {
      // Conta inexistente ou desativada seguem o mesmo caminho: pagar o tempo e
      // responder igual. Uma conta desativada que recebesse o e-mail saberia que
      // ainda existe no sistema.
      await this.hashService.gerar(this.gerarCodigo());
      return;
    }

    const codigo = this.gerarCodigo();
    const codigoHash = await this.hashService.gerar(codigo);

    await this.sequelize.transaction(async (transaction) => {
      /**
       * Pedir um codigo novo invalida o anterior.
       *
       * Sem isso, cada pedido somaria mais um codigo valido e o atacante
       * ganharia tentativas gratuitas. O indice unico parcial do banco e quem
       * garante de fato o limite de um ativo por usuario, inclusive sob
       * requisicoes simultaneas.
       */
      await this.recuperacaoModel.update(
        { invalidadoEm: new Date() },
        { where: this.filtroAtivo(usuario.id), transaction },
      );

      await this.recuperacaoModel.create(
        {
          usuarioId: usuario.id,
          codigoHash,
          expiraEm: new Date(Date.now() + MINUTOS_DE_VALIDADE * 60_000),
        },
        { transaction },
      );
    });

    void this.emailService.enviar({
      para: [{ email: usuario.email, nome: usuario.nome }],
      assunto: 'Código de recuperação de senha',
      texto: this.corpoEmTexto(usuario.nome, codigo),
      html: this.corpoEmHtml(usuario.nome, codigo),
    });

    this.avisarEmDesenvolvimento(usuario.email, codigo);
  }

  /**
   * Confirma o codigo e troca a senha.
   *
   * Toda falha sai como o mesmo 400 com a mesma mensagem (ver FALHA_GENERICA).
   */
  async confirmar(dto: ConfirmarRecuperacaoDto): Promise<void> {
    const usuario = await this.usuarioModel.findOne({ where: { email: dto.email } });

    if (!usuario || !usuario.ativo) {
      await this.hashService.gastarTempoDeVerificacao(dto.codigo);
      throw new BadRequestException(FALHA_GENERICA);
    }

    const recuperacao = await this.recuperacaoModel.findOne({
      where: this.filtroAtivo(usuario.id),
    });

    if (!recuperacao) {
      await this.hashService.gastarTempoDeVerificacao(dto.codigo);
      throw new BadRequestException(FALHA_GENERICA);
    }

    if (recuperacao.expiraEm.getTime() <= Date.now()) {
      await recuperacao.update({ invalidadoEm: new Date() });
      throw new BadRequestException(FALHA_GENERICA);
    }

    if (!(await this.hashService.conferir(recuperacao.codigoHash, dto.codigo))) {
      const tentativas = recuperacao.tentativas + 1;

      // Queimar o codigo ao atingir o teto e o que impede que o atacante
      // continue de onde parou pedindo outro codigo e somando tentativas.
      await recuperacao.update({
        tentativas,
        ...(tentativas >= MAX_TENTATIVAS ? { invalidadoEm: new Date() } : {}),
      });

      throw new BadRequestException(FALHA_GENERICA);
    }

    /**
     * NAO se verifica se a nova senha e igual a anterior.
     *
     * Em PATCH /usuarios/eu/senha essa checagem existe e faz sentido: o usuario
     * ja provou conhecer a senha atual. Aqui ele nao provou — responder "a nova
     * senha deve ser diferente da atual" confirmaria a quem tomou o codigo que
     * o palpite digitado E a senha da conta.
     */
    const senhaHash = await this.hashService.gerar(dto.novaSenha);

    await this.sequelize.transaction(async (transaction) => {
      await usuario.update({ senhaHash }, { transaction });
      await recuperacao.update({ usadoEm: new Date() }, { transaction });
    });

    this.logger.log(`Senha redefinida por codigo para o usuario ${usuario.id}.`);
  }

  /** Um codigo ativo = nao usado e nao invalidado. Espelha o indice parcial. */
  private filtroAtivo(usuarioId: string) {
    return { usuarioId, usadoEm: { [Op.is]: null }, invalidadoEm: { [Op.is]: null } };
  }

  /**
   * `randomInt` do modulo crypto, nao `Math.random`.
   *
   * `Math.random` e previsivel a partir de saidas anteriores: quem pedisse
   * varios codigos conseguiria prever o proximo. `randomInt` usa o gerador
   * criptografico do sistema e e uniforme no intervalo.
   */
  private gerarCodigo(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  private corpoEmTexto(nome: string, codigo: string): string {
    return [
      `Olá, ${nome}.`,
      '',
      'Recebemos um pedido para redefinir a senha da sua conta na plataforma de monitoria.',
      '',
      `Seu código de confirmação é: ${codigo}`,
      '',
      `O código vale por ${MINUTOS_DE_VALIDADE} minutos e só pode ser usado uma vez.`,
      '',
      'Se você não pediu esta troca, ignore esta mensagem: sua senha continua a mesma.',
    ].join('\n');
  }

  private corpoEmHtml(nome: string, codigo: string): string {
    // O nome vem do cadastro, ou seja, de entrada do usuario. Interpolar direto
    // em HTML permitiria injetar marcacao no e-mail de outra pessoa.
    const nomeSeguro = escaparHtml(nome);

    return [
      `<p>Olá, ${nomeSeguro}.</p>`,
      '<p>Recebemos um pedido para redefinir a senha da sua conta na plataforma de monitoria.</p>',
      `<p>Seu código de confirmação é: <strong style="font-size:20px">${codigo}</strong></p>`,
      `<p>O código vale por ${MINUTOS_DE_VALIDADE} minutos e só pode ser usado uma vez.</p>`,
      '<p>Se você não pediu esta troca, ignore esta mensagem: sua senha continua a mesma.</p>',
    ].join('\n');
  }

  /**
   * Saida de emergencia para DESENVOLVIMENTO.
   *
   * Sem Brevo configurado nada e enviado, e o codigo so existe como hash no
   * banco — ou seja, o fluxo ficaria impossivel de testar localmente. Aqui ele
   * vai para o log, sob duas condicoes simultaneas: e-mail nao configurado E
   * ambiente diferente de producao.
   *
   * A guarda de NODE_ENV e o que importa. Em producao, esquecer a chave do
   * Brevo passaria a imprimir codigos de troca de senha no log — e log e o
   * lugar menos protegido da operacao. Por isso a condicao e explicita e nao
   * depende apenas da ausencia de configuracao.
   */
  private avisarEmDesenvolvimento(email: string, codigo: string): void {
    const ambiente = this.config.get<string>('app.ambiente');

    if (ambiente === 'production' || this.emailService.estaConfigurado()) {
      return;
    }

    this.logger.warn(
      `[DESENVOLVIMENTO] Codigo de recuperacao de ${email}: ${codigo} — ` +
        'exibido porque o e-mail nao esta configurado. Nunca acontece em producao.',
    );
  }
}

/** Escape minimo para interpolacao em corpo HTML. */
function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
