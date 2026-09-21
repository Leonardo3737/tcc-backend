import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Hash de senha isolado atras de um service.
 *
 * Algoritmo: argon2id — vencedor da Password Hashing Competition e recomendacao
 * atual do OWASP. Preferido a bcrypt por resistir melhor a ataque com GPU/ASIC
 * (custo de memoria, nao so de CPU) e por nao ter o limite de 72 bytes do bcrypt,
 * que trunca senhas longas em silencio.
 *
 * Os parametros abaixo seguem a recomendacao OWASP (19 MiB, 2 iteracoes, 1 thread).
 * O salt e gerado e embutido no proprio hash pela lib — nao ha coluna de salt.
 */
@Injectable()
export class HashService {
  private readonly opcoes: argon2.HashOptions = {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  };

  private hashDescartavel?: string;

  async gerar(senhaEmTexto: string): Promise<string> {
    return argon2.hash(senhaEmTexto, this.opcoes);
  }

  /**
   * Executa uma verificacao real contra um hash descartavel.
   *
   * Usado no login quando o e-mail nao existe: sem isso, a resposta para um
   * e-mail inexistente voltaria muito mais rapido que a de um e-mail valido com
   * senha errada, e essa diferenca de tempo revelaria quais contas existem.
   * O hash e gerado de verdade (uma unica vez) justamente para que o custo seja
   * o mesmo de uma conferencia legitima.
   */
  async gastarTempoDeVerificacao(senhaEmTexto: string): Promise<void> {
    this.hashDescartavel ??= await this.gerar('hash-descartavel-para-igualar-tempo-de-resposta');
    await this.conferir(this.hashDescartavel, senhaEmTexto);
  }

  /**
   * Nunca lanca: um hash malformado no banco vira "senha invalida", nao um 500
   * que revelaria ao atacante que aquele e-mail existe.
   */
  async conferir(hashArmazenado: string, senhaEmTexto: string): Promise<boolean> {
    try {
      return await argon2.verify(hashArmazenado, senhaEmTexto);
    } catch {
      return false;
    }
  }
}
