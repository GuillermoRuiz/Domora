import {
  OWNER_HOME_LINK,
  ownerEstateSectionLink,
  ownerMeetingsLink,
  ownerPropertyLink,
  ownerReceiptsLink,
} from './owner-links';

describe('owner-links', () => {
  it('la ficha de una propiedad, con o sin pestaña', () => {
    expect(ownerPropertyLink('p1')).toBe('/c/properties/p1');
    expect(ownerPropertyLink('p1', 'communications')).toBe(
      '/c/properties/p1?tab=communications',
    );
    expect(ownerPropertyLink('p1', 'reservas')).toBe(
      '/c/properties/p1?tab=reservas',
    );
  });

  it('Recibos y pagos, en la propiedad y con el recibo si se conoce', () => {
    expect(ownerReceiptsLink('p1')).toBe('/c/recibos?propertyId=p1');
    expect(ownerReceiptsLink('p1', 'r9')).toBe(
      '/c/recibos?propertyId=p1&receipt=r9',
    );
    expect(ownerReceiptsLink('p1', null)).toBe('/c/recibos?propertyId=p1');
  });

  it('Juntas, en la comunidad y con la junta si se conoce', () => {
    expect(ownerMeetingsLink('e1')).toBe('/c/juntas?estateId=e1');
    expect(ownerMeetingsLink('e1', 'm1')).toBe(
      '/c/juntas?estateId=e1&meeting=m1',
    );
  });

  it('una pestaña de la ficha sin propiedad pasa por «Mi comunidad» con la finca', () => {
    expect(ownerEstateSectionLink('e1', 'communications')).toBe(
      '/c/community?tab=communications&estateId=e1',
    );
    expect(OWNER_HOME_LINK).toBe('/c/community');
  });
});
