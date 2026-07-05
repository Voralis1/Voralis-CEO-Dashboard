import { redirect } from "next/navigation";

// Africod Congo a été fusionné dans la vue groupée "Réseaux Logistiques / COD" — on redirige
// vers cette page avec le réseau déjà pré-sélectionné, pour ne pas casser les liens/favoris
// existants vers cette ancienne URL.
export default function AfricodCongoRedirect() {
  redirect("/ceo/logistics-cod?reseau=africod-congo");
}
