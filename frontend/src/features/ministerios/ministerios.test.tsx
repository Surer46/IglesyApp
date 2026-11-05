import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { db } from '@/mocks/db';
import { renderApp } from '@/test/renderApp';

describe('listado de ministerios (F2-07)', () => {
  it('muestra tarjetas activas con integrantes y coordinadores', async () => {
    await renderApp('/ministerios', { como: 'u-secretario' });
    const lista = await screen.findByRole('list', { name: 'Ministerios' });
    expect(within(lista).getByRole('link', { name: 'Jóvenes' })).toBeInTheDocument();
    expect(within(lista).getByText('Coordinación: María Chan')).toBeInTheDocument();
    expect(within(lista).queryByRole('link', { name: 'Damas' })).not.toBeInTheDocument();
    // SECRETARIO solo lee
    expect(screen.queryByRole('button', { name: /Nuevo ministerio/ })).not.toBeInTheDocument();
  });

  it('estado vacío', async () => {
    const { usuario } = await renderApp('/ministerios', { como: 'u-admin' });
    await screen.findByRole('list', { name: 'Ministerios' });
    await usuario.type(screen.getByRole('searchbox'), 'zzzz');
    expect(
      await screen.findByText('No hay ministerios con estos filtros', {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });
});

describe('formulario de ministerio (F2-08)', () => {
  it('crea un ministerio', async () => {
    const { usuario } = await renderApp('/ministerios', { como: 'u-pastor' });
    await usuario.click(await screen.findByRole('button', { name: /Nuevo ministerio/ }));
    const dialogo = await screen.findByRole('dialog');
    await usuario.type(within(dialogo).getByLabelText(/Nombre/), 'Servicio');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(db.ministerios.some((m) => m.nombre === 'Servicio')).toBe(true));
  });

  it('valida y muestra el 409 por nombre duplicado en el campo', async () => {
    const { usuario } = await renderApp('/ministerios', { como: 'u-admin' });
    await usuario.click(await screen.findByRole('button', { name: /Nuevo ministerio/ }));
    const dialogo = await screen.findByRole('dialog');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialogo).findByText('Escribe el nombre.')).toBeInTheDocument();

    const nombre = within(dialogo).getByLabelText(/Nombre/);
    await usuario.type(nombre, 'música');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
    expect(
      await within(dialogo).findByText('Ya existe un ministerio con ese nombre.'),
    ).toBeInTheDocument();
    expect(nombre).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('actividades del ministerio (F2-11)', () => {
  it('separa próximos y pasados, con enlace al detalle y estado', async () => {
    const pasado = db.eventos.find((e) => e.id === 'ev-culto-pasado')!;
    pasado.ministerioId = 'min-jovenes';
    const { usuario } = await renderApp('/ministerios/min-jovenes', { como: 'u-secretario' });
    await usuario.click(await screen.findByRole('tab', { name: 'Actividades' }));

    const proximos = await screen.findByRole('list', { name: 'Próximos eventos' });
    expect(within(proximos).getByRole('link', { name: 'Convivencia de jóvenes' })).toHaveAttribute(
      'href',
      '/eventos/ev-cancelado',
    );
    expect(within(proximos).getByText('Cancelado')).toBeInTheDocument();
    expect(within(proximos).queryByText('Ensayo de alabanza')).not.toBeInTheDocument();

    const pasados = await screen.findByRole('list', { name: 'Eventos pasados' });
    expect(within(pasados).getByRole('link', { name: 'Culto dominical' })).toBeInTheDocument();
    expect(within(pasados).queryByText('Convivencia de jóvenes')).not.toBeInTheDocument();
  });

  it('estado vacío', async () => {
    const { usuario } = await renderApp('/ministerios/min-ninos', { como: 'u-secretario' });
    await usuario.click(await screen.findByRole('tab', { name: 'Actividades' }));
    expect(await screen.findByText('No hay eventos programados.')).toBeInTheDocument();
    expect(screen.getByText('Todavía no hay eventos pasados.')).toBeInTheDocument();
  });

  it('"Nuevo evento" precarga el ministerio para su coordinador', async () => {
    const { usuario } = await renderApp('/ministerios/min-jovenes', { como: 'u-coordinador' });
    await usuario.click(await screen.findByRole('tab', { name: 'Actividades' }));
    expect(await screen.findByRole('link', { name: /Nuevo evento/ })).toHaveAttribute(
      'href',
      '/eventos/nuevo?ministerioId=min-jovenes',
    );
  });

  it('COORDINADOR de otro ministerio no ve "Nuevo evento"', async () => {
    const { usuario } = await renderApp('/ministerios/min-musica', { como: 'u-coordinador' });
    await usuario.click(await screen.findByRole('tab', { name: 'Actividades' }));
    await screen.findByRole('list', { name: 'Próximos eventos' });
    expect(screen.queryByRole('link', { name: /Nuevo evento/ })).not.toBeInTheDocument();
  });

  it('TESORERO solo consulta: no ve "Nuevo evento"', async () => {
    const { usuario } = await renderApp('/ministerios/min-musica', { como: 'u-tesorero' });
    await usuario.click(await screen.findByRole('tab', { name: 'Actividades' }));
    await screen.findByRole('list', { name: 'Próximos eventos' });
    expect(screen.queryByRole('link', { name: /Nuevo evento/ })).not.toBeInTheDocument();
  });
});

describe('exportar (A1-F2-02)', () => {
  it('el detalle ofrece "Exportar" a quien ve el reporte; TESORERO no', async () => {
    const { unmount } = await renderApp('/ministerios/min-jovenes', { como: 'u-secretario' });
    expect(await screen.findByRole('button', { name: /Exportar/ })).toBeInTheDocument();
    unmount();
    await renderApp('/ministerios/min-jovenes', { como: 'u-tesorero' });
    await screen.findByRole('table', { name: 'Integrantes' });
    expect(screen.queryByRole('button', { name: /Exportar/ })).not.toBeInTheDocument();
  });
});

describe('exportar: coordinador (A1-F2-02)', () => {
  it('lo ve en su ministerio', async () => {
    await renderApp('/ministerios/min-jovenes', { como: 'u-coordinador' });
    expect(await screen.findByRole('button', { name: /Exportar/ })).toBeInTheDocument();
  });

  it('no lo ve en un ministerio ajeno (el backend respondería 403)', async () => {
    await renderApp('/ministerios/min-musica', { como: 'u-coordinador' });
    await screen.findByRole('table', { name: 'Integrantes' });
    expect(screen.queryByRole('button', { name: /Exportar/ })).not.toBeInTheDocument();
  });
});

describe('detalle del ministerio (F2-09, F2-10)', () => {
  it('lista integrantes y muestra históricos con el interruptor', async () => {
    const { usuario } = await renderApp('/ministerios/min-jovenes', { como: 'u-secretario' });
    const tabla = await screen.findByRole('table', { name: 'Integrantes' });
    expect(within(tabla).getByText('Ana Pérez Uc')).toBeInTheDocument();
    expect(within(tabla).queryByText('Luis Aké Novelo')).not.toBeInTheDocument();
    await usuario.click(screen.getByRole('switch', { name: 'Ver históricos' }));
    expect(
      await within(screen.getByRole('table', { name: 'Integrantes' })).findByText(
        'Luis Aké Novelo',
      ),
    ).toBeInTheDocument();
    // SECRETARIO no gestiona integrantes ni coordinadores
    expect(screen.queryByRole('button', { name: /Agregar integrantes/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar coordinadores/ })).not.toBeInTheDocument();
  });

  it('COORDINADOR del ministerio agrega varios con SelectorMiembros y quita uno', async () => {
    const { usuario } = await renderApp('/ministerios/min-jovenes', { como: 'u-coordinador' });
    await usuario.click(await screen.findByRole('button', { name: /Agregar integrantes/ }));
    const dialogo = await screen.findByRole('dialog');
    await usuario.click(within(dialogo).getByRole('combobox', { name: 'Miembros' }));

    const listbox = await screen.findByRole('listbox', { name: 'Miembros' });
    // Los integrantes actuales no se ofrecen
    expect(within(listbox).queryByRole('option', { name: /Ana Pérez Uc/ })).not.toBeInTheDocument();
    await usuario.click(await within(listbox).findByRole('option', { name: /María Pech Canul/ }));
    await usuario.click(within(listbox).getByRole('option', { name: /Pedro Euán Ku/ }));
    expect(within(listbox).getByRole('option', { name: /María Pech Canul/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await usuario.keyboard('{Escape}');

    const chips = within(dialogo).getByRole('list', { name: 'Miembros seleccionados' });
    expect(within(chips).getAllByRole('listitem')).toHaveLength(2);
    await usuario.click(within(dialogo).getByRole('button', { name: 'Agregar' }));
    await waitFor(() =>
      expect(
        db.vinculos
          .filter((v) => v.ministerioId === 'min-jovenes' && v.activo)
          .map((v) => v.miembroId),
      ).toEqual(expect.arrayContaining(['m-maria', 'm-pedro'])),
    );

    const integrantes = await screen.findByRole('table', { name: 'Integrantes' });
    await usuario.click(within(integrantes).getByRole('button', { name: 'Quitar a Ana Pérez Uc' }));
    await usuario.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Quitar' }),
    );
    await waitFor(() =>
      expect(
        db.vinculos.find((v) => v.ministerioId === 'min-jovenes' && v.miembroId === 'm-ana')
          ?.activo,
      ).toBe(false),
    );
  });

  it('COORDINADOR de otro ministerio no ve los botones', async () => {
    await renderApp('/ministerios/min-musica', { como: 'u-coordinador' });
    await screen.findByRole('table', { name: 'Integrantes' });
    expect(screen.queryByRole('button', { name: /Agregar integrantes/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Quitar a/ })).not.toBeInTheDocument();
  });

  it('PASTOR edita los coordinadores', async () => {
    const { usuario } = await renderApp('/ministerios/min-ninos', { como: 'u-pastor' });
    await usuario.click(await screen.findByRole('button', { name: /Editar coordinadores/ }));
    const dialogo = await screen.findByRole('dialog');
    await usuario.click(await within(dialogo).findByRole('checkbox', { name: /María Chan/ }));
    // Solo se ofrecen usuarios con rol Coordinador o Pastor
    expect(
      within(dialogo).queryByRole('checkbox', { name: /Jorge Canul/ }),
    ).not.toBeInTheDocument();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(db.coordinaciones).toContainEqual({
        ministerioId: 'min-ninos',
        usuarioId: 'u-coordinador',
      }),
    );
  });
});
