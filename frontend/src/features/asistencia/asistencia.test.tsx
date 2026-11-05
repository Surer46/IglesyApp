import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { db } from '@/mocks/db';
import { renderApp } from '@/test/renderApp';

describe('selección de evento para pasar lista (F3-06)', () => {
  it('lista los eventos de hoy con acceso al pase de lista', async () => {
    await renderApp('/asistencia', { como: 'u-secretario' });
    const lista = await screen.findByRole('list', { name: 'Eventos del día' }, { timeout: 3000 });
    expect(within(lista).getByText('Culto de oración')).toBeInTheDocument();
    expect(within(lista).getByText('Reunión de jóvenes')).toBeInTheDocument();
    expect(within(lista).getAllByRole('link', { name: /Pasar lista/ })).toHaveLength(2);
  });

  it('COORDINADOR solo ve eventos de sus ministerios', async () => {
    await renderApp('/asistencia', { como: 'u-coordinador' });
    const lista = await screen.findByRole('list', { name: 'Eventos del día' }, { timeout: 3000 });
    expect(within(lista).getByText('Reunión de jóvenes')).toBeInTheDocument();
    expect(within(lista).queryByText('Culto de oración')).not.toBeInTheDocument();
  });

  it('sin eventos ofrece crear un culto rápido (si el rol puede)', async () => {
    db.eventos = db.eventos.filter((e) => !e.id.endsWith('-hoy'));
    const { usuario } = await renderApp('/asistencia', { como: 'u-secretario' });
    await usuario.click(
      await screen.findByRole('button', { name: /Crear evento rápido/ }, { timeout: 3000 }),
    );
    expect(
      await screen.findByRole('heading', { name: /Pase de lista: Culto/ }),
    ).toBeInTheDocument();
    expect(db.eventos.some((e) => e.titulo === 'Culto' && e.categoria === 'CULTO')).toBe(true);
  });

  it('TESORERO no tiene acceso a asistencia', async () => {
    await renderApp('/asistencia', { como: 'u-tesorero' });
    expect(await screen.findByRole('heading', { name: 'No tienes acceso' })).toBeInTheDocument();
  });
});

describe('pase de lista (F3-07)', () => {
  it('marca, cuenta en vivo, guarda y al reabrir muestra lo guardado', async () => {
    const { usuario, unmount } = await renderApp('/eventos/ev-culto-hoy/asistencia', {
      como: 'u-secretario',
    });
    await screen.findByRole('heading', { name: /Pase de lista: Culto de oración/ });
    expect(screen.getByText(/0 presentes/)).toBeInTheDocument();
    const guardar = screen.getByRole('button', { name: /Guardar asistencia/ });
    expect(guardar).toBeDisabled();

    const presenteJose = screen.getByRole('button', { name: 'Presente: José Chan May' });
    expect(presenteJose).toHaveClass('size-11'); // objetivo táctil ≥ 44 px
    await usuario.click(presenteJose);
    expect(presenteJose).toHaveAttribute('aria-pressed', 'true');
    await usuario.click(screen.getByRole('button', { name: /Marcar restantes como ausentes/ }));
    expect(screen.getByText(/1 presentes/)).toBeInTheDocument();
    expect(screen.getByText(/7 ausentes/)).toBeInTheDocument();

    await usuario.click(guardar);
    await waitFor(() =>
      expect(db.asistencias.filter((a) => a.eventoId === 'ev-culto-hoy')).toHaveLength(8),
    );
    expect(
      db.asistencias.find((a) => a.eventoId === 'ev-culto-hoy' && a.miembroId === 'm-jose')
        ?.presente,
    ).toBe(true);
    unmount();

    // Reabrir: la lista parte de lo guardado
    await renderApp('/eventos/ev-culto-hoy/asistencia', { como: 'u-secretario' });
    expect(await screen.findByRole('button', { name: 'Presente: José Chan May' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Ausente: María Pech Canul' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('una recarga de la lista (red, foco) no borra lo marcado sin guardar', async () => {
    const { usuario, queryClient } = await renderApp('/eventos/ev-culto-hoy/asistencia', {
      como: 'u-secretario',
    });
    await screen.findByRole('heading', { name: /Pase de lista: Culto de oración/ });
    await usuario.click(screen.getByRole('button', { name: 'Presente: José Chan May' }));
    // Otro dispositivo guardó a María mientras tanto; luego la lista se recarga
    db.asistencias.push({
      id: 'as-otro',
      eventoId: 'ev-culto-hoy',
      miembroId: 'm-maria',
      presente: true,
      registradoPorId: 'u-admin',
      registradoEn: new Date().toISOString(),
    });
    await queryClient.refetchQueries({ queryKey: ['asistencia', 'evento', 'ev-culto-hoy'] });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Presente: María Pech Canul' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    expect(screen.getByRole('button', { name: 'Presente: José Chan May' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Tienes cambios sin guardar')).toBeInTheDocument();
  });

  it('una marca ya guardada se puede cambiar pero no quitar', async () => {
    const { usuario } = await renderApp('/eventos/ev-culto-pasado/asistencia', {
      como: 'u-admin',
    });
    const presente = await screen.findByRole('button', { name: 'Presente: José Chan May' });
    expect(presente).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByText(/se pueden cambiar entre presente y ausente, pero no quitar/),
    ).toBeInTheDocument();
    await usuario.click(presente);
    expect(presente).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Todo guardado')).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Ausente: José Chan May' }));
    expect(presente).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Tienes cambios sin guardar')).toBeInTheDocument();
    // Una marca nueva (sin guardar) sí se puede quitar
    const sofia = screen.getByRole('button', { name: 'Presente: Sofía Núñez Poot' });
    await usuario.click(sofia);
    await usuario.click(sofia);
    expect(sofia).toHaveAttribute('aria-pressed', 'false');
  });

  it('busca y filtra: sin marcar / presentes', async () => {
    const { usuario } = await renderApp('/eventos/ev-culto-pasado/asistencia', {
      como: 'u-admin',
    });
    const lista = await screen.findByRole('list', { name: 'Lista de asistencia' });
    await usuario.click(screen.getByRole('button', { name: 'Presentes' }));
    expect(within(lista).getAllByRole('listitem')).toHaveLength(3);
    await usuario.click(screen.getByRole('button', { name: 'Todos' }));
    await usuario.type(screen.getByRole('searchbox'), 'sofia');
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Lista de asistencia' })).getAllByRole('listitem'),
      ).toHaveLength(1),
    );
  });

  it('evento cancelado: pantalla bloqueada con mensaje', async () => {
    await renderApp('/eventos/ev-cancelado/asistencia', { como: 'u-admin' });
    expect(await screen.findByText('Este evento está cancelado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Guardar asistencia/ })).not.toBeInTheDocument();
  });

  it('muestra el error del servidor (evento a más de 1 día)', async () => {
    const { usuario } = await renderApp('/eventos/ev-junta/asistencia', { como: 'u-admin' });
    await screen.findByRole('heading', { name: /Pase de lista: Junta administrativa/ });
    await usuario.click(screen.getByRole('button', { name: /Marcar todos presentes/ }));
    await usuario.click(screen.getByRole('button', { name: /Guardar asistencia/ }));
    expect(
      await screen.findByText(
        'Solo se puede pasar lista desde un día antes del inicio del evento.',
      ),
    ).toBeInTheDocument();
  });
});

describe('historial de asistencia (F3-08)', () => {
  it('lee los filtros de la URL', async () => {
    await renderApp('/asistencia?tab=historial&eventoId=ev-culto-pasado', { como: 'u-secretario' });
    const tabla = await screen.findByRole(
      'table',
      { name: 'Historial de asistencia' },
      { timeout: 3000 },
    );
    expect(within(tabla).getAllByRole('row')).toHaveLength(6); // encabezado + 5
    expect(within(tabla).getAllByText('Presente')).toHaveLength(3);
  });

  it('estado vacío', async () => {
    db.asistencias = [];
    await renderApp('/asistencia?tab=historial', { como: 'u-secretario' });
    expect(
      await screen.findByText(
        'No hay asistencia registrada con estos filtros',
        {},
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
  });
});

describe('resumen de asistencia (F3-09)', () => {
  it('incluye una tabla accesible equivalente a la gráfica', async () => {
    const { usuario } = await renderApp('/asistencia?tab=resumen', { como: 'u-pastor' });
    const tabla = await screen.findByRole(
      'table',
      { name: 'Resumen de asistencia' },
      { timeout: 3000 },
    );
    // Fila de la semana del culto pasado: 1 evento, 3 presentes, 2 ausentes
    const fila = within(tabla)
      .getAllByRole('row')
      .find((r) => within(r).queryAllByRole('cell')[1]?.textContent === '1');
    expect(fila).toBeDefined();
    expect(
      within(fila!)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(expect.arrayContaining(['1', '3', '2', '3']));
    expect(
      within(tabla).getByRole('columnheader', { name: 'Promedio por evento' }),
    ).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Mensual' }));
    expect(screen.getByRole('button', { name: 'Mensual' })).toHaveAttribute('aria-pressed', 'true');
    // Exportar usa el BotonExportar de F4 (PDF / Excel)
    expect(screen.getByRole('button', { name: /Exportar/ })).toBeInTheDocument();
  });
});
