/**
 * Configuración de la aplicación.
 *
 * modo: 'estatico'   -> lee los JSON publicados (GitHub Pages / raw). Recomendado.
 *       'directo'    -> descarga el .xlsx del repositorio con la API de Google Drive.
 *       'appsscript' -> usa una implementación de Apps Script como intermediario.
 */
window.CONFIG = {
  modo: 'estatico',

  // --- Modo estático --------------------------------------------------
  // Dirección de la carpeta con indice.json y los JSON mensuales.
  // Relativa ('datos/') cuando la app y los datos se publican juntos;
  // absoluta cuando se abre el archivo local y los datos están en GitHub.
  baseDatos: 'datos/',

  // --- Modo directo (requiere clave de API de Drive) -------------------
  driveApiKey: '',
  carpetaId: '14Ys-yK1Z8buTEi0jcDb7LCPhoVxqyoYi',

  // --- Modo Apps Script (respaldo) ------------------------------------
  endpoint: 'https://script.google.com/macros/s/REEMPLAZAR_POR_SU_ID/exec',

  // --- Identidad y presentación ---------------------------------------
  estudiante: 'Said Chavez',
  titulo: 'Panel Meteorológico URBE',
  logo: 'assets/logo-urbe.png',
  anchoHistograma: 1,          // ancho de los intervalos del histograma, en m/s
  umbralCoberturaHora: 0.8,    // por debajo de 0,8 se marca la hora como insuficiente
  tiempoEsperaMs: 180000       // 3 min en modo Apps Script
};
