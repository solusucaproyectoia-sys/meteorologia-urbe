(function () {
  'use strict';

  var estado = { indice: null, graficos: {} };

  document.addEventListener('DOMContentLoaded', iniciar);

  /* ---------------------------------------------------------------- */
  /* Arranque                                                          */
  /* ---------------------------------------------------------------- */

  function iniciar() {
    document.getElementById('nombre-estudiante').textContent = CONFIG.estudiante;
    document.getElementById('titulo-app').textContent = CONFIG.titulo;

    var logo = document.getElementById('logo');
    function mostrarRespaldo() {
      logo.style.display = 'none';
      document.getElementById('logo-respaldo').style.display = 'grid';
    }
    logo.addEventListener('error', mostrarRespaldo);
    logo.src = CONFIG.logo;
    if (logo.complete && logo.naturalWidth === 0) mostrarRespaldo();

    document.getElementById('btn-consultar').addEventListener('click', consultar);
    document.getElementById('sel-anio').addEventListener('change', function () {
      llenarMeses(Number(this.value));
      consultar();
    });
    document.getElementById('sel-mes').addEventListener('change', function () {
      llenarDias();
      consultar();
    });
    document.getElementById('sel-dia').addEventListener('change', consultar);

    if (CONFIG.modo === 'appsscript' && CONFIG.endpoint.indexOf('REEMPLAZAR') !== -1) {
      mostrarEstado('error', 'Falta configurar la URL del servicio en js/config.js (propiedad endpoint).');
      return;
    }
    if (CONFIG.modo === 'directo' && !CONFIG.driveApiKey) {
      mostrarEstado('error', 'Falta configurar driveApiKey en js/config.js para leer el repositorio desde el navegador.');
      return;
    }
    if (CONFIG.modo === 'estatico' && !CONFIG.baseDatos) {
      mostrarEstado('error', 'Falta configurar baseDatos en js/config.js (dirección de los JSON publicados).');
      return;
    }
    cargarIndice();
  }

  /* ---------------------------------------------------------------- */
  /* Índice y consulta (el proveedor está en proveedor.js)             */
  /* ---------------------------------------------------------------- */

  function cargarIndice() {
    mostrarEstado('cargando', 'Consultando los archivos disponibles en el repositorio…');
    Proveedor.indice().then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        throw new Error((respuesta && respuesta.error) || 'Respuesta inválida del servicio.');
      }
      estado.indice = respuesta;
      llenarAnios(respuesta.meses);
      mostrarEstado('ok', 'Repositorio «' + respuesta.carpeta + '»: ' +
        respuesta.meses.length + ' archivos mensuales disponibles.');
      consultar();
    }).catch(function (error) {
      mostrarEstado('error', error.message);
    });
  }

  function llenarAnios(meses) {
    if (!meses.length) {
      mostrarEstado('alerta', 'El repositorio no devolvió ningún archivo mensual.');
      return;
    }
    var anios = [];
    meses.forEach(function (m) {
      if (anios.indexOf(m.anio) === -1) anios.push(m.anio);
    });
    anios.sort(function (a, b) { return a - b; });

    var selector = document.getElementById('sel-anio');
    selector.innerHTML = '';
    anios.forEach(function (anio) {
      var opcion = document.createElement('option');
      opcion.value = anio;
      opcion.textContent = anio;
      selector.appendChild(opcion);
    });
    selector.value = anios[anios.length - 1];

    llenarMeses(anios[anios.length - 1]);
  }

  function llenarMeses(anio) {
    var meses = estado.indice.meses.filter(function (m) { return m.anio === anio; });
    var selector = document.getElementById('sel-mes');
    selector.innerHTML = '';
    meses.forEach(function (m) {
      var opcion = document.createElement('option');
      opcion.value = m.mes;
      opcion.textContent = nombreMes(m.mes);
      selector.appendChild(opcion);
    });
    selector.value = meses[meses.length - 1].mes;
    llenarDias();
  }

  function llenarDias() {
    var anio = Number(document.getElementById('sel-anio').value);
    var mes = Number(document.getElementById('sel-mes').value);
    var total = Metricas.horasDelDia(anio, mes);
    var selector = document.getElementById('sel-dia');
    var anterior = Number(selector.value) || 1;
    selector.innerHTML = '';
    for (var dia = 1; dia <= total; dia++) {
      var opcion = document.createElement('option');
      opcion.value = dia;
      opcion.textContent = dia;
      selector.appendChild(opcion);
    }
    selector.value = Math.min(anterior, total);
  }

  function nombreMes(mes) {
    var nombres = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return nombres[mes - 1] || String(mes);
  }

  function dosDigitos(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // Los nombres vienen del repositorio (contenido externo): nunca se insertan
  // como HTML sin escapar.
  function escapar(texto) {
    return String(texto === null || texto === undefined ? '' : texto)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function viasDeAcceso(origen) {
    var vias = {
      'json-publicado': 'JSON publicados en GitHub · generados desde el .xlsx original',
      drive: 'API de Google Drive · descarga directa del .xlsx',
      appsscript: 'Servicio Apps Script (JSONP)'
    };
    return vias[origen] || escapar(String(origen || '—'));
  }

  /* ---------------------------------------------------------------- */
  /* Consulta y pintado del día                                        */
  /* ---------------------------------------------------------------- */

  function consultar() {
    var anio = Number(document.getElementById('sel-anio').value);
    var mes = Number(document.getElementById('sel-mes').value);
    var dia = Number(document.getElementById('sel-dia').value);
    if (!anio || !mes || !dia) return;

    var fecha = anio + '-' + dosDigitos(mes) + '-' + dosDigitos(dia);
    mostrarEstado('cargando', 'Descargando y procesando los registros del ' + fecha + '…');

    Proveedor.dia(fecha).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        throw new Error((respuesta && respuesta.error) || 'El servicio no devolvió datos.');
      }
      pintar(respuesta);
    }).catch(function (error) {
      // Si la consulta falla no deben quedar en pantalla las gráficas de la
      // fecha anterior: se confundirían con los datos pedidos.
      borrarGraficos();
      limpiarIndicadores('Sin datos para la fecha consultada.');
      document.getElementById('procedencia').innerHTML =
        '<p class="vacio">' + escapar(error.message) + '</p>';
      mostrarEstado('error', error.message);
    });
  }

  function pintar(respuesta) {
    var datos = Metricas.normalizar(respuesta);

    if (!datos.registros.length) {
      mostrarEstado('alerta', 'El archivo ' + respuesta.archivo +
        ' existe, pero no contiene registros para el ' + respuesta.fecha +
        '. Revise el día seleccionado.');
      pintarProcedencia(respuesta, null);
      borrarGraficos();
      limpiarIndicadores('Sin registros para esta fecha.');
      return;
    }

    var histograma = Metricas.histograma(
      datos.registros.map(function (r) { return r.viento; }),
      CONFIG.anchoHistograma
    );
    var perfilRadiacion = Metricas.perfilHorario(datos.registros, 'radiacion', datos.intervalo);
    var perfilTemperatura = Metricas.perfilHorario(datos.registros, 'temperatura', datos.intervalo);
    var resumenViento = Metricas.resumen(datos.registros, 'viento');
    var resumenRadiacion = Metricas.resumen(datos.registros, 'radiacion');
    var resumenTemperatura = Metricas.resumen(datos.registros, 'temperatura');
    var irradiacion = Metricas.irradiacionDiaria(datos.registros, datos.intervalo);
    var horasDeficientes = Metricas.horasInsuficientes(perfilTemperatura, CONFIG.umbralCoberturaHora);

    pintarProcedencia(respuesta, datos);
    pintarViento(histograma, resumenViento, datos);
    pintarRadiacion(perfilRadiacion, resumenRadiacion, irradiacion, datos);
    pintarTemperatura(perfilTemperatura, resumenTemperatura, horasDeficientes, datos);

    var mensaje = 'Datos cargados: ' + datos.registros.length + ' registros del ' +
      respuesta.fecha + ' (intervalo de ' + datos.intervalo + ' min, archivo ' +
      respuesta.archivo + ').';
    mostrarEstado('ok', mensaje);
  }

  /* ---------------------------------------------------------------- */
  /* Procedencia de los datos                                          */
  /* ---------------------------------------------------------------- */

  function pintarProcedencia(respuesta, datos) {
    var contenedor = document.getElementById('procedencia');
    var enlace = '<a href="' + escapar(respuesta.archivoUrl) + '" target="_blank" rel="noopener">' +
      escapar(respuesta.archivo) + '</a>';
    var sinDato = respuesta.sinDato || { viento: 0, radiacion: 0, temperatura: 0 };

    var filas = [
      ['Archivo consultado', enlace],
      ['Identificador', '<code>' + escapar(respuesta.archivoId) + '</code>'],
      ['Hoja del libro', escapar(respuesta.hoja)],
      ['Registros en el archivo', escapar(String(respuesta.totalFilasArchivo))],
      ['Registros del día', datos ? datos.registros.length + ' de ' + Math.round(1440 / datos.intervalo) + ' esperados' : '0'],
      ['Intervalo de muestreo', escapar(String(datos ? datos.intervalo : respuesta.intervalo)) + ' minutos'],
      ['Unidades del archivo (usUnits)', escapar(String(respuesta.usUnits)) + ' (16 = métrico: °C, km/h, mm, W/m²)'],
      ['Vía de acceso', viasDeAcceso(respuesta.origen)],
      ['Consultado', escapar(String(respuesta.generado))]
    ];

    if (datos) {
      filas.push(['Registros sin dato', 'viento: ' + sinDato.viento +
        ' · radiación: ' + sinDato.radiacion +
        ' · temperatura: ' + sinDato.temperatura]);
    }

    var html = '<dl class="lista-datos">';
    filas.forEach(function (fila) {
      html += '<div><dt>' + fila[0] + '</dt><dd>' + fila[1] + '</dd></div>';
    });
    html += '</dl>';

    html += '<p class="cobertura-repositorio">' + textoCoberturaRepositorio() + '</p>';
    contenedor.innerHTML = html;
  }

  function textoCoberturaRepositorio() {
    if (!estado.indice) return '';
    var disponibles = estado.indice.meses.map(function (m) {
      return m.anio + '-' + dosDigitos(m.mes);
    });
    var faltantes = [];
    var totales = 0;
    for (var anio = 2023; anio <= 2026; anio++) {
      for (var mes = 1; mes <= 12; mes++) {
        var etiqueta = anio + '-' + dosDigitos(mes);
        if (etiqueta < '2023-08' || etiqueta > '2026-07') continue;
        totales++;
        if (disponibles.indexOf(etiqueta) === -1) faltantes.push(etiqueta);
      }
    }
    var texto = 'Cobertura del periodo documental (ago-2023 a jul-2026): ' +
      (totales - faltantes.length) + ' de ' + totales + ' meses.';
    if (faltantes.length) {
      texto += ' Meses sin archivo en el repositorio: ' + faltantes.join(', ') + '.';
    }
    return texto;
  }

  /* ---------------------------------------------------------------- */
  /* Tarjetas e indicadores                                            */
  /* ---------------------------------------------------------------- */

  function formato(valor, decimales) {
    if (valor === null || valor === undefined || !isFinite(valor)) return '—';
    return valor.toLocaleString('es-VE', {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales
    });
  }

  function porcentaje(valor) {
    if (valor === null || valor === undefined || !isFinite(valor)) return '—';
    return (valor * 100).toLocaleString('es-VE', { maximumFractionDigits: 1 }) + ' %';
  }

  function listaIndicadores(items) {
    var html = '<dl class="indicadores-lista">';
    items.forEach(function (item) {
      html += '<div><dt>' + item[0] + '</dt><dd>' + item[1] + '</dd></div>';
    });
    return html + '</dl>';
  }

  function pintarViento(histograma, resumen, datos) {
    var cobertura = Metricas.coberturaDiaria(resumen.n, datos.intervalo);
    document.getElementById('ind-viento').innerHTML = listaIndicadores([
      ['Velocidad media', formato(resumen.media, 2) + ' m/s'],
      ['Velocidad máxima', formato(resumen.maximo, 2) + ' m/s'],
      ['Registros válidos', formato(resumen.n, 0) + ' de ' + formato(cobertura.esperados, 0) + ' (' + porcentaje(cobertura.fraccion) + ')'],
      ['Registros sin dato', formato(resumen.sinDato, 0)],
      ['Intervalos del histograma', histograma.bins.length + ' de ' + formato(CONFIG.anchoHistograma, 1) + ' m/s']
    ]);
    dibujarHistograma(histograma);
  }

  function pintarRadiacion(perfil, resumen, irradiacion, datos) {
    var cobertura = Metricas.coberturaDiaria(resumen.n, datos.intervalo);
    document.getElementById('ind-radiacion').innerHTML = listaIndicadores([
      ['Máximo diario', formato(resumen.maximo, 0) + ' W/m²'],
      ['Promedio de registros válidos', formato(resumen.media, 1) + ' W/m²'],
      ['Cobertura', formato(resumen.n, 0) + ' de ' + formato(cobertura.esperados, 0) + ' (' + porcentaje(cobertura.fraccion) + ')'],
      ['Irradiación diaria estimada', formato(irradiacion, 2) + ' kWh/m² <span class="etiqueta-calculo">cálculo derivado</span>'],
      ['Registros sin dato', formato(resumen.sinDato, 0)]
    ]);
    dibujarPerfil('grafico-radiacion', perfil,
      'Promedio por hora (W/m²)', 'Irradiancia (W/m²)', '#f0a202', true);
  }

  function pintarTemperatura(perfil, resumen, horasDeficientes, datos) {
    var cobertura = Metricas.coberturaDiaria(resumen.n, datos.intervalo);
    var detalleHoras = horasDeficientes.length
      ? horasDeficientes.map(function (h) { return h.hora + ' h'; }).join(', ')
      : 'ninguna';
    document.getElementById('ind-temperatura').innerHTML = listaIndicadores([
      ['Temperatura media', formato(resumen.media, 1) + ' °C'],
      ['Mínima / máxima', formato(resumen.minimo, 1) + ' °C / ' + formato(resumen.maximo, 1) + ' °C'],
      ['Cobertura', formato(resumen.n, 0) + ' de ' + formato(cobertura.esperados, 0) + ' (' + porcentaje(cobertura.fraccion) + ')'],
      ['Horas con cobertura insuficiente', formato(horasDeficientes.length, 0) + ' (' + detalleHoras + ')'],
      ['Registros sin dato', formato(resumen.sinDato, 0)]
    ]);
    dibujarPerfil('grafico-temperatura', perfil,
      'Promedio por hora (°C)', 'Temperatura del aire (°C)', '#d1495b', false);
  }

  function limpiarIndicadores(mensaje) {
    ['ind-viento', 'ind-radiacion', 'ind-temperatura'].forEach(function (id) {
      document.getElementById(id).innerHTML = '<p class="vacio">' + mensaje + '</p>';
    });
  }

  /* ---------------------------------------------------------------- */
  /* Gráficas (Chart.js)                                               */
  /* ---------------------------------------------------------------- */

  function borrarGraficos() {
    Object.keys(estado.graficos).forEach(function (clave) {
      estado.graficos[clave].destroy();
      delete estado.graficos[clave];
    });
  }

  function dibujarHistograma(histograma) {
    var ctx = document.getElementById('grafico-viento').getContext('2d');
    if (estado.graficos.viento) estado.graficos.viento.destroy();

    estado.graficos.viento = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: histograma.bins.map(function (b) { return b.etiqueta; }),
        datasets: [{
          label: 'Frecuencia absoluta',
          data: histograma.bins.map(function (b) { return b.frecuencia; }),
          backgroundColor: '#1f6feb',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'N.º de registros' } },
          x: { title: { display: true, text: 'Velocidad del viento (m/s)' } }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: function (items) { return items[0].label + ' m/s'; },
              label: function (item) {
                var bin = histograma.bins[item.dataIndex];
                return 'Frecuencia: ' + bin.frecuencia + ' (' + porcentaje(bin.relativa) + ')';
              }
            }
          }
        }
      }
    });
  }

  function dibujarPerfil(idCanvas, perfil, tituloEjeY, unidad, color, relleno) {
    var ctx = document.getElementById(idCanvas).getContext('2d');
    var clave = idCanvas === 'grafico-radiacion' ? 'radiacion' : 'temperatura';
    if (estado.graficos[clave]) estado.graficos[clave].destroy();

    estado.graficos[clave] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: perfil.map(function (p) { return p.etiqueta; }),
        datasets: [{
          label: tituloEjeY,
          data: perfil.map(function (p) { return p.media; }),
          borderColor: color,
          backgroundColor: relleno ? 'rgba(240, 162, 2, 0.18)' : 'rgba(209, 73, 91, 0.10)',
          fill: relleno,
          spanGaps: false,
          tension: 0.25,
          pointRadius: 3,
          pointHoverRadius: 5,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: false,
            title: { display: true, text: unidad }
          },
          x: { title: { display: true, text: 'Hora local (America/Caracas)' } }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: function (items) { return items[0].label + ':00'; },
              label: function (item) {
                var punto = perfil[item.dataIndex];
                return tituloEjeY + ': ' + formato(punto.media, 2) +
                  ' · registros: ' + punto.n + ' de ' + punto.esperados;
              }
            }
          }
        }
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Estado                                                            */
  /* ---------------------------------------------------------------- */

  function mostrarEstado(tipo, mensaje) {
    var elemento = document.getElementById('estado');
    elemento.className = 'estado estado-' + tipo;
    elemento.textContent = mensaje;
  }
})();
