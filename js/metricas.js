(function (raiz) {
  'use strict';

  // Factores de conversión a m/s según usUnits de WeeWX:
  // 16 = METRIC (km/h) · 17 = METRICWX (m/s) · 1 = US (mph)
  var FACTOR_A_MS = { 16: 1 / 3.6, 17: 1, 1: 0.44704 };

  function numero(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    var n = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  function aMetrosPorSegundo(valor, usUnits) {
    var n = numero(valor);
    if (n === null) return null;
    var f = FACTOR_A_MS[Number(usUnits)];
    return n * (f === undefined ? 1 / 3.6 : f);
  }

  function horasDelDia(anio, mes) {
    return new Date(anio, mes, 0).getDate();
  }

  // Convierte la respuesta del servicio (registros crudos del archivo mensual)
  // en registros normalizados listos para graficar.
  function normalizar(respuesta) {
    var usUnits = numero(respuesta.usUnits);
    var intervalo = numero(respuesta.intervalo) || 5;
    var crudos = respuesta.registros || [];

    var registros = crudos.map(function (r) {
      var t = String(r.t || '').replace('T', ' ').slice(0, 19);
      return {
        t: t,
        hora: Number(t.slice(11, 13)),
        minuto: Number(t.slice(14, 16)),
        viento: aMetrosPorSegundo(r.v, usUnits),
        racha: aMetrosPorSegundo(r.g, usUnits),
        radiacion: numero(r.r),
        temperatura: numero(r.temp)
      };
    }).filter(function (r) {
      return isFinite(r.hora) && r.t.length >= 16;
    }).sort(function (a, b) {
      return a.t < b.t ? -1 : a.t > b.t ? 1 : 0;
    });

    return {
      usUnits: usUnits,
      intervalo: intervalo,
      registros: registros
    };
  }

  // Histograma de frecuencias absolutas y relativas.
  // Si aparecen valores absurdos (p. ej. un pico de sensor), el número de
  // intervalos se limita a MAX_INTERVALOS y el último pasa a ser abierto ("≥ x").
  var MAX_INTERVALOS = 40;

  function histograma(valores, ancho) {
    ancho = ancho || 1;
    var validos = [];
    var suma = 0;
    var maximo = 0;
    var i;
    for (i = 0; i < valores.length; i++) {
      var x = valores[i];
      if (x === null || !isFinite(x) || x < 0) continue;
      validos.push(x);
      suma += x;
      if (x > maximo) maximo = x;
    }
    var n = validos.length;
    if (!n) {
      return { bins: [], n: 0, media: null, maximo: null, sinDato: valores.length };
    }
    var cantidad = Math.max(1, Math.ceil((maximo + 1e-9) / ancho));
    var abierto = cantidad > MAX_INTERVALOS;
    if (abierto) cantidad = MAX_INTERVALOS;

    var bins = [];
    for (var k = 0; k < cantidad; k++) {
      var desde = k * ancho;
      var hasta = desde + ancho;
      bins.push({
        indice: k,
        desde: desde,
        hasta: hasta,
        etiqueta: desde.toFixed(1) + '–' + hasta.toFixed(1),
        frecuencia: 0,
        relativa: 0,
        abierto: false
      });
    }
    if (abierto) {
      var ultimo = bins[bins.length - 1];
      ultimo.etiqueta = '≥ ' + ultimo.desde.toFixed(1);
      ultimo.abierto = true;
    }
    validos.forEach(function (x) {
      var k = Math.floor(x / ancho);
      if (k >= cantidad) k = cantidad - 1;
      if (k < 0) k = 0;
      bins[k].frecuencia++;
    });
    bins.forEach(function (b) {
      b.relativa = b.frecuencia / n;
    });
    return {
      bins: bins,
      n: n,
      media: suma / n,
      maximo: maximo,
      sinDato: valores.length - n
    };
  }

  // Perfil horario (24 horas). "esperados" = registros que debería tener cada hora
  // según el intervalo real del archivo (5 min -> 12 · 15 min -> 4).
  function perfilHorario(registros, campo, intervalo) {
    var esperados = intervalo > 0 ? Math.round(60 / intervalo) : null;
    var acumulado = [];
    var h;
    for (h = 0; h < 24; h++) acumulado.push({ suma: 0, n: 0 });

    registros.forEach(function (r) {
      var v = numero(r[campo]);
      var hora = r.hora;
      if (v === null || !isFinite(hora) || hora < 0 || hora > 23) return;
      acumulado[hora].suma += v;
      acumulado[hora].n++;
    });

    return acumulado.map(function (a, indice) {
      return {
        hora: indice,
        etiqueta: (indice < 10 ? '0' : '') + indice,
        media: a.n ? a.suma / a.n : null,
        n: a.n,
        esperados: esperados,
        cobertura: esperados ? Math.min(1, a.n / esperados) : null
      };
    });
  }

  function resumen(registros, campo) {
    var valores = [];
    registros.forEach(function (r) {
      var v = numero(r[campo]);
      if (v !== null) valores.push(v);
    });
    if (!valores.length) {
      return { n: 0, media: null, minimo: null, maximo: null, sinDato: registros.length };
    }
    var suma = 0;
    valores.forEach(function (v) { suma += v; });
    return {
      n: valores.length,
      media: suma / valores.length,
      minimo: Math.min.apply(null, valores),
      maximo: Math.max.apply(null, valores),
      sinDato: registros.length - valores.length
    };
  }

  // Cobertura del día: registros válidos / registros esperados (1440 / intervalo).
  function coberturaDiaria(n, intervalo) {
    var esperados = intervalo > 0 ? 1440 / intervalo : null;
    if (!esperados) return null;
    return { n: n, esperados: esperados, fraccion: Math.min(1, n / esperados) };
  }

  // Irradiación diaria estimada (kWh/m²) a partir de la irradiancia media de cada
  // registro. Es un CÁLCULO DERIVADO: no debe presentarse como medición.
  function irradiacionDiaria(registros, intervalo) {
    if (!intervalo) return null;
    var suma = 0;
    registros.forEach(function (r) {
      var v = numero(r.radiacion);
      if (v !== null) suma += v * (intervalo / 60);
    });
    return suma / 1000;
  }

  function horasInsuficientes(perfil, umbral) {
    umbral = umbral === undefined ? 0.8 : umbral;
    var horas = [];
    perfil.forEach(function (p) {
      if (p.n === 0) horas.push({ hora: p.etiqueta, motivo: 'sin registros', cobertura: 0 });
      else if (p.cobertura !== null && p.cobertura < umbral) horas.push({ hora: p.etiqueta, motivo: 'cobertura baja', cobertura: p.cobertura });
    });
    return horas;
  }

  raiz.Metricas = {
    numero: numero,
    aMetrosPorSegundo: aMetrosPorSegundo,
    horasDelDia: horasDelDia,
    normalizar: normalizar,
    histograma: histograma,
    perfilHorario: perfilHorario,
    resumen: resumen,
    coberturaDiaria: coberturaDiaria,
    irradiacionDiaria: irradiacionDiaria,
    horasInsuficientes: horasInsuficientes
  };
})(typeof window !== 'undefined' ? window : globalThis);
