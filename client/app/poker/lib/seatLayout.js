// Seat geometry shared by every place that renders the poker table.
//
// Player seats are absolute-positioned on a wide ellipse. SEATS[0] is "me"
// (the local user, always at the bottom); seats 1-4 walk clockwise from the
// dealer's left. Spectators see the same layout but with seat 0 = the first
// seated player in `gameState.players`.

export const SEATS = [
  { top: '100%', left: '50%' }, // 0: Bottom Center (Me)
  { top: '65%',  left: '5%' },  // 1: Bottom Left
  { top: '15%',  left: '20%' }, // 2: Top Left  (clear of the header)
  { top: '15%',  left: '80%' }, // 3: Top Right (clear of the header)
  { top: '65%',  left: '95%' }, // 4: Bottom Right
]

// Where the seat's bet stack should appear relative to the seat. Bottom seat
// pushes its bets up onto the felt; side seats push them inward toward the
// pot.
export function getBetPosClasses(posIndex) {
  switch (posIndex) {
    case 0: return 'bottom-[calc(100%+0.25rem)] lg:bottom-[105%] left-1/2 -translate-x-1/2'
    case 1: case 2: return 'left-[105%] sm:left-[110%] top-1/2 -translate-y-1/2'
    case 3: case 4: return 'right-[105%] sm:right-[110%] top-1/2 -translate-y-1/2'
    default: return ''
  }
}

// Origin direction for the animated chip-throw sprite. Drives which side of
// the seat the chip animation enters from.
export function getChipThrowOrigin(posIndex) {
  switch (posIndex) {
    case 1: case 2: return 'left'
    case 3: case 4: return 'right'
    case 0:
    default: return 'bottom'
  }
}
