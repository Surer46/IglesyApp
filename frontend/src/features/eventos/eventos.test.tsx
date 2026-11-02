import { screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/mocks/db';
import { server } from '@/mocks/server';
import { errorApi, ruta } from '@/mocks/utils';
import { renderApp } from '@/test/renderApp';

const matchMediaOriginal = window.matchMedia;
afterEach(() => {
  window.matchMedia = matchMediaOriginal;
});

/** Simula una pantalla de celular (< 768 px) para window.matchMedia. */
function simularMovil() {
  window.matchMedia = vi.fn((query: string) => ({
    ...matchMediaOriginal(query),
    matches: query.includes('max-width: 767px'),
  }));
}

describe('calendario de eventos (F3-01)', () => {
  it('muestra los eventos del mes y una leyenda con texto e ícono (no solo color)', async () => {
    await renderApp('/eventos', { como: 'u-secretario' });
    expect(
      await screen.findByText(/Reunión de jóvenes/, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    const leyenda = screen.getByRole('list', { name: 'Leyenda de categorías' });
    for (const texto of ['Culto', 'Reunión', 'Actividad', 'Otro', 'Cancelado']) {
      expect(within(leyenda).getByText(texto)).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: /Nuevo evento/ })).toBeInTheDocument();
  });

  it('en móvil la vista por defecto es Lista', async () => {
    simularMovil();
    const { container } = await renderApp('/eventos', { como: 'u-secretario' });
    await waitFor(() => expect(container.querySelector('.fc-list')).not.toBeNull());
    expect(container.querySelector('.fc-daygrid')).toBeNull();
  });

  it('TESORERO solo consulta: no ve "Nuevo evento"', async () => {
    await renderApp('/eventos', { como: 'u-tesorero' });
    await screen.findByText(/Reunión de jóvenes/, {}, { timeout: 3000 });
    expect(screen.queryByRole('link', { name: /Nuevo evento/ })).not.toBeInTheDocument();
  });
});

describe('formulario de evento (F3-02)', () => {
  it('valida título y que la hora de fin no sea anterior a la de inicio', async () => {
    const { usuario } = await renderApp('/eventos/nuevo', { como: 'u-secretario' });
    await screen.findByRole('heading', { name: 'Nuevo evento' });
    const fin = screen.getByLabelText('Hora de fin');
    await usuario.type(fin, '08:00');
    await usuario.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Escribe el título.')).toBeInTheDocument();
    expect(
      screen.getByText('La hora de fin debe ser igual o posterior a la de inicio.'),
    ).toBeInTheDocument();
    expect(fin).toHaveAttribute('aria-invalid', 'true');
  });

  it('precarga ?fecha= y ?ministerioId=, crea el evento y abre su detalle', async () => {
    const { usuario } = await renderApp('/eventos/nuevo?fecha=2030-05-17&ministerioId=min-musica', {
      como: 'u-secretario',
    });
    await screen.findByRole('heading', { name: 'Nuevo evento' });
    expect(screen.getByText('17/05/2030')).toBeInTheDocument();
    await usuario.type(screen.getByLabelText(/Título/), 'Concierto de primavera');
    await usuario.type(screen.getByLabelText(/Lugar/), 'Explanada');
    await usuario.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(
      await screen.findByRole('heading', { name: 'Concierto de primavera' }, { timeout: 3000 }),
    ).toBeInTheDocument();
    const creado = db.eventos.find((e) => e.titulo === 'Concierto de primavera');
    expect(creado).toMatchObject({ ministerioId: 'min-musica', creadoPorId: 'u-secretario' });
    expect(new Date(creado!.fechaInicio).getDate()).toBe(17);
  });

  it('COORDINADOR debe elegir uno de sus ministerios', async () => {
    const { usuario } = await renderApp('/eventos/nuevo', { como: 'u-coordinador' });
    await screen.findByRole('heading', { name: 'Nuevo evento' });
    await usuario.type(screen.getByLabelText(/Título/), 'Convivencia');
    await usuario.type(screen.getByLabelText(/Lugar/), 'Parque');
    await usuario.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(
      await screen.findByText('Elige uno de los ministerios que coordinas.'),
    ).toBeInTheDocument();
  });
});

describe('detalle del evento (F3-03, F3-04, F3-05)', () => {
  it('muestra datos, responsables, asistencia y acciones según permisos', async () => {
    await renderApp('/eventos/ev-culto-pasado', { como: 'u-secretario' });
    expect(await screen.findByRole('heading', { name: 'Culto dominical' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Responsables' })).getByText('José Chan May'),
    ).toBeInTheDocument();
    expect(screen.getByText('Presentes').nextSibling).toHaveTextContent('3');
    expect(screen.getByRole('link', { name: /Pasar lista/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Editar/ })).toBeInTheDocument();
  });

  it('evento cancelado muestra el motivo y oculta Editar y Pasar lista', async () => {
    await renderApp('/eventos/ev-cancelado', { como: 'u-admin' });
    await screen.findByRole('heading', { name: 'Convivencia de jóvenes' });
    expect(screen.getByText(/Pronóstico de lluvia intensa/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Editar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Pasar lista/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancelar evento/ })).not.toBeInTheDocument();
  });

  it('COORDINADOR no edita eventos de otros ministerios', async () => {
    await renderApp('/eventos/ev-ensayo', { como: 'u-coordinador' });
    await screen.findByRole('heading', { name: 'Ensayo de alabanza' });
    expect(screen.queryByRole('link', { name: /Editar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Pasar lista/ })).not.toBeInTheDocument();
  });

  it('responsables: un 422 indica qué miembro no es válido', async () => {
    server.use(
      http.put(ruta('/eventos/:id/responsables'), () =>
        errorApi(422, 'BUSINESS_RULE', 'No se pueden asignar como responsables.', [
          { campo: 'miembroIds', mensaje: 'Rosa Castillo Ek está inactivo.' },
        ]),
      ),
    );
    const { usuario } = await renderApp('/eventos/ev-ensayo', { como: 'u-pastor' });
    await screen.findByRole('heading', { name: 'Ensayo de alabanza' });
    await usuario.click(screen.getByRole('button', { name: /^Editar$/ }));
    const dialogo = await screen.findByRole('dialog');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialogo).findByText('Rosa Castillo Ek está inactivo.')).toBeInTheDocument();
  });

  it('responsables: "Cancelar" descarta los cambios', async () => {
    const { usuario } = await renderApp('/eventos/ev-ensayo', { como: 'u-pastor' });
    await screen.findByRole('heading', { name: 'Ensayo de alabanza' });
    await usuario.click(screen.getByRole('button', { name: /^Editar$/ }));
    let dialogo = await screen.findByRole('dialog');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Quitar' }));
    expect(within(dialogo).getByText('0 de 10 seleccionados')).toBeInTheDocument();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await usuario.click(screen.getByRole('button', { name: /^Editar$/ }));
    dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('1 de 10 seleccionados')).toBeInTheDocument();
    expect(db.responsables.filter((r) => r.eventoId === 'ev-ensayo')).toHaveLength(1);
  });

  it('cancelar con un motivo corto explica qué falta', async () => {
    const { usuario } = await renderApp('/eventos/ev-ensayo', { como: 'u-pastor' });
    await screen.findByRole('heading', { name: 'Ensayo de alabanza' });
    await usuario.click(screen.getByRole('button', { name: /Cancelar evento/ }));
    const dialogo = await screen.findByRole('dialog');
    await usuario.type(within(dialogo).getByLabelText(/Motivo/), 'no');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar evento' }));
    expect(
      await within(dialogo).findByText('El motivo debe tener al menos 5 caracteres.'),
    ).toBeInTheDocument();
    expect(db.eventos.find((e) => e.id === 'ev-ensayo')?.estado).toBe('PROGRAMADO');
  });

  it('cancelar pide motivo y el calendario se actualiza sin recargar', async () => {
    const { usuario } = await renderApp('/eventos/ev-ensayo', { como: 'u-pastor' });
    await screen.findByRole('heading', { name: 'Ensayo de alabanza' });
    await usuario.click(screen.getByRole('button', { name: /Cancelar evento/ }));
    const dialogo = await screen.findByRole('dialog');
    const confirmar = within(dialogo).getByRole('button', { name: 'Cancelar evento' });
    expect(confirmar).toBeDisabled();
    await usuario.type(within(dialogo).getByLabelText(/Motivo/), 'Falta de músicos');
    await usuario.click(confirmar);
    await waitFor(() => expect(screen.getByText(/Motivo: Falta de músicos/)).toBeInTheDocument());
    expect(db.eventos.find((e) => e.id === 'ev-ensayo')?.estado).toBe('CANCELADO');

    await usuario.click(screen.getByRole('link', { name: /Calendario/ }));
    const titulo = await screen.findByText(/Ensayo de alabanza/, {}, { timeout: 3000 });
    expect(titulo).toHaveClass('line-through');
  });
});
