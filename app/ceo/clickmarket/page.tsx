import { redirect } from "next/navigation";

// ClickMarket a été fusionné dans la vue groupée "Réseaux Logistiques / COD" — on redirige
// vers cette page avec le réseau déjà pré-sélectionné, pour ne pas casser les liens/favoris
// existants vers cette ancienne URL.
export default function ClickMarketRedirect() {
  redirect("/ceo/logistics-cod?reseau=clickmarket");
}
