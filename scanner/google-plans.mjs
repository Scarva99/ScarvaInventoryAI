// Google non scrive il piano sul computer, quindi lo chiede la pagina alla prima apertura.
// Prezzi di listino per l'Italia: da ricontrollare su https://gemini.google/it/subscriptions/
export const GOOGLE_PLANS = {
  verificato: "l'8/11/2026",
  piani: [
    { id: 'plus', nome: 'Google AI Plus', prezzo: '4,99 € al mese' },
    { id: 'pro', nome: 'Google AI Pro', prezzo: '21,99 € al mese' },
    { id: 'ultra-5x', nome: 'Google AI Ultra 5x', prezzo: '99,99 € al mese' },
    { id: 'ultra-20x', nome: 'Google AI Ultra 20x', prezzo: '219,99 € al mese' },
  ],
};

// Trasforma la risposta salvata in dichiarato.json nel piano da mostrare.
export function googlePlan(declared) {
  const answer = declared?.pianoGoogle;
  if (!answer || answer.scelta === 'nessuno') return null;
  if (answer.scelta === 'altro') return { nome: answer.nome, prezzo: answer.prezzo || '' };
  return GOOGLE_PLANS.piani.find((p) => p.id === answer.scelta) || null;
}
