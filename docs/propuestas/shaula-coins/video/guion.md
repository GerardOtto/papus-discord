---
title: Tienda Shaula: cómo funciona
hook_title: La *Tienda Shaula* de los Papus
target: 70
background: palette
background_style: suave
music: triple_baka_song
broll: none
language: es
---
<!-- tutorial_20261027_tienda_shaula | tutorial para el Discord de los Papus (no es un episodio del canal) | escritor manual (Claude Code, pedido de GyroP 27-10-2026) -->
// Tutorial de la tienda de Shaula-coins (papus-discord, PLAN §3.6): lo gratis contra lo de pago. v2 (GyroP, 27-10-2026):
// voces con Fish Speech 1.5 LOCAL (sin credito de Fish Audio; .cache/local_tts, refs de Teto, Miku y Neru de episodios
// anteriores). Triple Baka de fondo (el trio Miku, Teto y Neru), por eso outputSpeed 1.331 (la cancion esta
// pre-estirada x0.751); cada bloque a [TEMPO:0.87] para que la voz quede a x1.16, el ritmo estandar del canal.
// Neru hace de escéptica ("¿otra tienda para cobrarnos?"); Teto atiende la tienda en el bot; Miku anuncia las vitrinas.

## hook
[TETO:emocionado]
[TEMPO:0.87]
[VISUAL: ts_banner]
¡Papus! Abrimos la *Tienda Shaula* en el Discord.

[NERU:enojado]
[LISTEN: teto:feliz]
[TEMPO:0.87]
¿Otra tienda para cobrarnos? Qué flojera.

## context
[MIKU:feliz]
[LISTEN: neru:sorprendido]
[TEMPO:0.87]
[VISUAL: ts_moneda]
¡No, Neru! Las *Shaula-coins* se ganan *gratis*: chateando, en voz, con las misiones de la ruleta, subiendo de nivel y en las bodas.

[TETO:presumido]
[LISTEN: miku:feliz]
[TEMPO:0.87]
[VISUAL: ts_sobre_cerrado]
Con 200 monedas ganadas abres un *sobre*: de tres a cinco objetos. ¡Y te regalo uno cada día que completes las tres misiones de la ruleta, y otro cada lunes si participaste tres días!

[MIKU:emocionado]
[LISTEN: teto:feliz]
[TEMPO:0.87]
[VISUAL: ts_sobre_abierto]
Cada diez sobres, una *Épica* segura. Cada cuarenta, una *Legendaria*. Los repetidos se vuelven Ecos para fabricar lo que te falte.

## development
[NERU:pensando]
[LISTEN: teto:sorprendido]
[TEMPO:0.87]
[VISUAL: ts_gemelos]
¿Y los fondos con nosotras? Seguro esos son de pago.

[TETO:riendo]
[LISTEN: neru:sorprendido]
[TEMPO:0.87]
¡Al revés! *Todos* los fondos con Vocaloids, hasta la Mítica, se consiguen *solo* con monedas ganadas.

[MIKU:nerd]
[LISTEN: neru:pensando]
[TEMPO:0.87]
[VISUAL: ts_vitrina]
Las monedas de pago solo compran arte propio a precio fijo: bordes, barras y efectos de nombre. *Sin azar*.

[TETO:feliz]
[LISTEN: miku:feliz]
[TEMPO:0.87]
[VISUAL: ts_monedero]
Y si tienes membresía de Puerro, Atún, Baguette o más, ¡te llegan monedas de *regalo* cada mes!

[NERU:sorprendido]
[LISTEN: miku:neutral]
[TEMPO:0.87]
¿Y me dan más mensajes con ustedes?

[MIKU:neutral]
[LISTEN: neru:decepcionado]
[TEMPO:0.87]
No. Nada de esto da XP ni cuota. Es solo para lucir tu *tarjeta*.

## closing
[TETO:saludando]
[LISTEN: miku:feliz]
[TEMPO:0.87]
[VISUAL: ts_menu]
Entra a *tienda-shaula*, toca un botón y listo. ¡La vitrina cambia los lunes y los jueves!

[NERU:presumido]
[LISTEN: teto:feliz, miku:feliz]
[TEMPO:0.87]
[VISUAL: ts_tarjeta_neru]
Bueno… mi tarjeta va a ser la más bonita.
