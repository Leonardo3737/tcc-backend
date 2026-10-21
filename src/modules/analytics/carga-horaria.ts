/**
 * Conversao de carga horaria. Funcoes puras, sem banco.
 *
 * Existem aqui, e nao dentro do service, porque dois consumidores precisam do
 * MESMO resultado: o endpoint de indicadores e o relatorio de monitoria em
 * .docx. Formatar em cada lugar faria a tela e o documento discordarem no
 * arredondamento — divergencia que ninguem nota, porque os dois numeros nunca
 * aparecem juntos.
 */

/** Minutos em uma hora. Nomeado para o `/ 60` nao virar numero solto. */
const MINUTOS_POR_HORA = 60;

/**
 * A unidade canonica e o MINUTO, e isso e decisao, nao detalhe.
 *
 * Hora decimal nao representa 1h20min sem dizima (1,3333...). Guardar e somar em
 * horas decimais acumularia erro de representacao, e uma carga horaria que nao
 * fecha na conta do aluno e pior que uma unidade menos conveniente. As horas
 * existem ao lado, com duas casas, apenas para exibicao.
 */
export function minutosEmCargaHoraria(minutos: number): {
  cargaHorariaMinutos: number;
  cargaHorariaHoras: number;
} {
  return {
    cargaHorariaMinutos: minutos,
    /**
     * `Math.round(x * 100) / 100` e nao `toFixed(2)`: o primeiro devolve
     * NUMERO, o segundo devolve string. Um campo numerico que ora e numero ora
     * e texto obriga o cliente a adivinhar, e `JSON.stringify` nao avisa.
     */
    cargaHorariaHoras: Math.round((minutos / MINUTOS_POR_HORA) * 100) / 100,
  };
}

/**
 * Carga horaria no formato que uma pessoa le: "21h05min".
 *
 * Usada na celula "Carga horaria" do relatorio e no total. Nao usa hora decimal
 * de proposito: "1,33h" obriga quem assina o documento a fazer a conta de
 * cabeca para conferir se cumpriu as 40h exigidas.
 *
 * Minutos acompanham o "h" sempre com dois digitos — "2h5min" se le como duas
 * horas e cinco minutos, mas "2h05min" nao deixa duvida.
 */
export function formatarCargaHoraria(minutos: number): string {
  if (minutos <= 0) {
    return '';
  }

  const horas = Math.floor(minutos / MINUTOS_POR_HORA);
  const resto = minutos % MINUTOS_POR_HORA;

  if (horas === 0) {
    return `${resto}min`;
  }

  if (resto === 0) {
    return `${horas}h`;
  }

  return `${horas}h${String(resto).padStart(2, '0')}min`;
}
