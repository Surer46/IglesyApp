import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { db } from '@/mocks/db';
import { renderApp } from '@/test/renderApp';
import { MarkdownSimple } from './components/MarkdownSimple';
import { TarjetaAnuncio } from './components/TarjetaAnuncio';

describe('listado de anuncios (F3-10)', () => {
  it('vigentes con IMPORTANTE primero; programados y expirados en sus pestañas', async () => {
    const { usuario } = await renderApp('/anuncios', { como: 'u-secretario' });
    const lista = await screen.findByRole('list', { name: 'Anuncios vigentes' }, { timeout: 3000 });
    const titulos = within(lista)
      .getAllByRole('heading')
      .map((h) => h.textContent);
    expect(titulos).toEqual(['Semana de ayuno y oración', 'Ensayo abierto de alabanza']);
    expect(within(lista).getByText('Importante')).toBeInTheDocument();
    expect(within(lista).getByRole('link', { name: 'Ensayo de alabanza' })).toBeInTheDocument();

    await usuario.click(screen.getByRole('tab', { name: 'Programados' }));
    expect(await screen.findByText('Inscripciones al campamento')).toBeInTheDocument();
    await usuario.click(screen.getByRole('tab', { name: 'Expirados' }));
    expect(await screen.findByText('Colecta de víveres')).toBeInTheDocument();
  });

  it('cada pestaña pagina en el servidor (más de 20 programados)', async () => {
    const base = db.anuncios.find((a) => a.id === 'an-programado')!;
    for (let i = 0; i < 25; i++) {
      db.anuncios.push({ ...base, id: `an-prog-${i}`, titulo: `Programado ${i}` });
    }
    const { usuario } = await renderApp('/anuncios?tab=programados', { como: 'u-secretario' });
    const lista = await screen.findByRole(
      'list',
      { name: 'Anuncios programados' },
      { timeout: 3000 },
    );
    expect(within(lista).getAllByRole('listitem')).toHaveLength(20);
    expect(screen.getByText('1–20 de 26')).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: /Siguiente/ }));
    expect(await screen.findByText('21–26 de 26')).toBeInTheDocument();
  });

  it('estado vacío', async () => {
    db.anuncios = [];
    await renderApp('/anuncios', { como: 'u-secretario' });
    expect(
      await screen.findByText('No hay anuncios vigentes', {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });
});

describe('crear, editar y eliminar anuncio (F3-11)', () => {
  it('valida y publica un anuncio', async () => {
    const { usuario } = await renderApp('/anuncios', { como: 'u-pastor' });
    await usuario.click(await screen.findByRole('button', { name: /Nuevo anuncio/ }));
    const dialogo = await screen.findByRole('dialog');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Publicar' }));
    expect(await within(dialogo).findByText('Escribe el título.')).toBeInTheDocument();
    expect(within(dialogo).getByText('Escribe el contenido.')).toBeInTheDocument();

    await usuario.type(within(dialogo).getByLabelText(/Título/), 'Bautizos');
    await usuario.type(within(dialogo).getByLabelText(/Contenido/), 'Inscríbete en la oficina.');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Publicar' }));
    await waitFor(() => expect(db.anuncios.some((a) => a.titulo === 'Bautizos')).toBe(true));
    expect(db.anuncios.find((a) => a.titulo === 'Bautizos')?.autorId).toBe('u-pastor');
  });

  it('elimina con confirmación', async () => {
    const { usuario } = await renderApp('/anuncios', { como: 'u-admin' });
    await usuario.click(
      await screen.findByRole('button', { name: 'Eliminar Ensayo abierto de alabanza' }),
    );
    const dialogo = await screen.findByRole('dialog');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(db.anuncios.some((a) => a.id === 'an-ensayo')).toBe(false));
  });

  it('roles sin permiso no ven botones de edición', async () => {
    await renderApp('/anuncios', { como: 'u-tesorero' });
    await screen.findByRole('list', { name: 'Anuncios vigentes' }, { timeout: 3000 });
    expect(screen.queryByRole('button', { name: /Nuevo anuncio/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Editar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Eliminar/ })).not.toBeInTheDocument();
  });

  it('el contenido se renderiza sanitizado (sin HTML arbitrario)', () => {
    const { container } = render(
      <MarkdownSimple
        texto={'<img src=x onerror="alert(1)"> **hola** [mal](javascript:alert(1))\n- uno'}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror="alert(1)">');
    expect(container.querySelector('strong')).toHaveTextContent('hola');
    expect(container.querySelector('li')).toHaveTextContent('uno');
  });
});

describe('componente para dashboard (F3-12)', () => {
  it('TarjetaAnuncio compacta sin autor', () => {
    render(
      <MemoryRouter>
        <TarjetaAnuncio
          compacta
          anuncio={{
            titulo: 'Aviso',
            contenido: 'Texto',
            prioridad: 'IMPORTANTE',
            fechaPublicacion: '2026-10-30T18:00:00.000Z',
            autor: { id: 'u', nombre: 'Autor oculto' },
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Aviso' })).toBeInTheDocument();
    expect(screen.getByText('Importante')).toBeInTheDocument();
    expect(screen.queryByText(/Autor oculto/)).not.toBeInTheDocument();
  });
});

describe('cartelera pública (F3-13)', () => {
  it('accesible sin sesión, con anuncios, eventos, horarios y "Acceso del personal"', async () => {
    await renderApp('/cartelera');
    expect(
      await screen.findByRole('heading', { name: 'Anuncios' }, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Semana de ayuno y oración')).toBeInTheDocument();
    expect(screen.queryByText('Inscripciones al campamento')).not.toBeInTheDocument();
    expect(screen.getByText('Ensayo de alabanza')).toBeInTheDocument();
    expect(screen.queryByText('Convivencia de jóvenes')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Horarios de reunión/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Acceso del personal/ })).toHaveAttribute(
      'href',
      '/login',
    );
  });
});
