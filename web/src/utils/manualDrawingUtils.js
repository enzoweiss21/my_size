// Helper functions for manual drawing mode

// Get next dot to place for front photo
export const getNextFrontDot = (manualDots) => {
  const widthOrder = ['shoulders', 'chest', 'waist', 'hips'];
  for (const type of widthOrder) {
    if (!manualDots.front[type].left) { return { type, side: 'left' }; }
    if (!manualDots.front[type].right) { return { type, side: 'right' }; }
  }
  if (!manualDots.front.thighs.left) { return { type: 'thighs', side: 'left' }; }
  if (!manualDots.front.thighs.right) { return { type: 'thighs', side: 'right' }; }
  if (!manualDots.front.thighs.top) { return { type: 'thighs', side: 'top' }; }
  if (!manualDots.front.knee.center) { return { type: 'knee', side: 'center' }; }
  if (!manualDots.front.calves.left) { return { type: 'calves', side: 'left' }; }
  if (!manualDots.front.calves.right) { return { type: 'calves', side: 'right' }; }
  if (!manualDots.front.calves.bottom) { return { type: 'calves', side: 'bottom' }; }
  return null;
};

// Get next dot to place for side photo
export const getNextSideDot = (manualDots) => {
  const order = ['chest', 'waist', 'hips', 'thighs', 'calves'];
  for (const type of order) {
    if (!manualDots.side[type].front) { return { type, side: 'front' }; }
    if (!manualDots.side[type].back) { return { type, side: 'back' }; }
  }
  return null;
};

// Check if all front dots are placed
export const areAllFrontDotsPlaced = (manualDots) => {
  const widthComplete = ['shoulders', 'chest', 'waist', 'hips'].every(type => 
    manualDots.front[type].left && manualDots.front[type].right
  );
  const thighsComplete = manualDots.front.thighs.left && manualDots.front.thighs.right && manualDots.front.thighs.top;
  const kneeComplete = manualDots.front.knee.center !== null;
  const calvesComplete = manualDots.front.calves.left && manualDots.front.calves.right && manualDots.front.calves.bottom;
  return widthComplete && thighsComplete && kneeComplete && calvesComplete;
};

// Check if all side dots are placed
export const areAllSideDotsPlaced = (manualDots) => {
  return ['chest', 'waist', 'hips', 'thighs', 'calves'].every(type => 
    manualDots.side[type].front && manualDots.side[type].back
  );
};

// Get dot color based on type and photo type
export const getDotColor = (photoType, type, side) => {
  const colors = {
    front: {
      shoulders: { left: '#ff6b6b', right: '#ee5a6f' },
      chest: { left: '#4ecdc4', right: '#44a08d' },
      waist: { left: '#3b82f6', right: '#ef4444' },
      hips: { left: '#9b59b6', right: '#8e44ad' },
      thighs: { left: '#f39c12', right: '#e67e22', top: '#f39c12' }, // Thickness (left/right) and length (top)
      knee: { center: '#e74c3c' }, // Knee center point
      calves: { left: '#1abc9c', right: '#16a085', bottom: '#1abc9c' } // left/right = thickness, bottom = ankle
    },
    side: {
      chest: { front: '#f59e0b', back: '#d97706' },
      waist: { front: '#f59e0b', back: '#8b5cf6' },
      hips: { front: '#10b981', back: '#059669' },
      thighs: { front: '#f39c12', back: '#e67e22' }, // Thigh depth/thickness
      calves: { front: '#1abc9c', back: '#16a085' }  // Calf depth/thickness
    }
  };
  return colors[photoType]?.[type]?.[side] || '#60a5fa';
};

