const WK = {
  schedule: [
    {day:'Monday',    sess:'A', note:'Gym — Session A'},
    {day:'Tuesday',   sess:null, note:'Rest / Recovery'},
    {day:'Wednesday', sess:null, note:'🏸 Badminton'},
    {day:'Thursday',  sess:'B', note:'Gym — Session B'},
    {day:'Friday',    sess:null, note:'Rest'},
    {day:'Saturday',  sess:null, note:'🏸 Badminton'},
    {day:'Sunday',    sess:null, note:'Rest'},
  ],
  sessions: {
    A: {
      name:'Session A — Push + Legs',
      duration:'~42 min',
      focus:'Quads, chest, shoulders, triceps, core',
      exercises:[
        {name:'Goblet Squat',muscle:'Quads · Glutes',
         w1:'4 × 12 reps',w2:'4 × 12 reps (+5 kg)',rest:'90s',
         tip:'Hold dumbbell/plate at chest. Sit deep, chest up, elbows INSIDE knees. Drive through heels.',
         yt:'goblet+squat+form+tutorial',vid:'dM_Vx1p2wS4'},
        {name:'Leg Press',muscle:'Quads · Hamstrings · Glutes',
         w1:'3 × 15 reps',w2:'3 × 15 reps (+10 kg)',rest:'90s',
         tip:'Feet shoulder-width at middle of plate. Push through heels. Stop 90° — never lock out fully.',
         yt:'leg+press+correct+form',vid:'IZxyjW8sL7E'},
        {name:'Incline Dumbbell Press',muscle:'Upper Chest · Front Delts · Triceps',
         w1:'3 × 12 reps',w2:'3 × 12 reps (+2 kg each)',rest:'75s',
         tip:'Set bench 30–45°. Elbows at 45° from body (not flared out). Full stretch at bottom.',
         yt:'incline+dumbbell+press+form+tutorial',vid:'8iP2SOTJ0cY'},
        {name:'Cable Chest Fly (High to Low)',muscle:'Chest · Stretch focus',
         w1:'3 × 15 reps',w2:'3 × 15 reps (+2.5 kg)',rest:'60s',
         tip:'Arms slightly bent throughout, squeeze hands together at belly. Slow 3-second negative.',
         yt:'cable+chest+fly+form',vid:'Kz2YwLJm7vY'},
        {name:'Tricep Rope Pushdown',muscle:'Triceps',
         w1:'3 × 15 reps',w2:'3 × 15 reps (+5 kg)',rest:'60s',
         tip:'Elbows pinned to sides throughout. Full extension, then FLARE rope handles outward at bottom.',
         yt:'tricep+rope+pushdown+form',vid:'2-LAM7zBQuA'},
        {name:'Plank Hold',muscle:'Core · Shoulders',
         w1:'3 × 40 seconds',w2:'3 × 50 seconds',rest:'45s',
         tip:'Squeeze glutes and abs simultaneously. Push the floor away. Hips level with shoulders.',
         yt:'perfect+plank+form+technique',vid:'BQu26ABu1BE'},
      ]
    },
    B: {
      name:'Session B — Pull + Hinge',
      duration:'~43 min',
      focus:'Hamstrings, back, rear delts, biceps, core',
      exercises:[
        {name:'Romanian Deadlift (DB or Bar)',muscle:'Hamstrings · Glutes · Lower Back',
         w1:'4 × 10 reps',w2:'4 × 10 reps (+5 kg)',rest:'90s',
         tip:'Push hips BACK (not down). Bar/dumbbells drag down legs. Feel hamstring stretch. Stop at mid-shin, neutral spine throughout.',
         yt:'romanian+deadlift+form+tutorial',vid:'_dQ3HXSsGrs'},
        {name:'Lat Pulldown (wide overhand grip)',muscle:'Lats · Upper Back · Biceps',
         w1:'4 × 12 reps',w2:'4 × 12 reps (+5 kg)',rest:'75s',
         tip:'Slight backward lean. Pull bar to UPPER chest. Full arm extension at top — get the stretch.',
         yt:'lat+pulldown+wide+grip+form',vid:'lueEJGjTuqo'},
        {name:'Seated Cable Row (close grip)',muscle:'Mid Back · Rhomboids · Rear Delts',
         w1:'3 × 12 reps',w2:'3 × 12 reps (+5 kg)',rest:'75s',
         tip:'Chest up, row handle to belly button. Hold 1 sec squeezed. Slow return — don\'t let weight pull you forward.',
         yt:'seated+cable+row+form+tutorial',vid:'GZbfasYl4Ik'},
        {name:'Dumbbell Shoulder Press (seated)',muscle:'Shoulders · Triceps',
         w1:'3 × 12 reps',w2:'3 × 12 reps (+2 kg each)',rest:'75s',
         tip:'Neutral grip (palms facing each other) is easier on shoulder joints at heavier weights. Press slightly inward at top.',
         yt:'dumbbell+shoulder+press+seated+form',vid:'qE0K6AtA0wM'},
        {name:'Dumbbell Bicep Curl (alternating)',muscle:'Biceps',
         w1:'3 × 12 each arm',w2:'3 × 12 each arm (+2 kg)',rest:'60s',
         tip:'Elbow PINNED at hip. Supinate (rotate wrist outward) as you curl up. Slow 3-second negative.',
         yt:'dumbbell+bicep+curl+form',vid:'ykJmrZ5v0Oo'},
        {name:'Dead Bug',muscle:'Core · Anti-extension',
         w1:'3 × 8 each side',w2:'3 × 10 each side',rest:'45s',
         tip:'Press LOWER BACK flat to floor throughout. Exhale as you extend. Move slow. Opposite arm + leg extend together.',
         yt:'dead+bug+exercise+correct+form',vid:'dF3woo27IlI'},
      ]
    }
  }
};

const BUILD = {
  'full-body': {
    name:'Full Body',icon:'💪',
    exercises:[
      {name:'Goblet Squat',muscle:'Quads · Glutes',sets:'4 × 12',rest:'90s',
       tip:'Hold dumbbell at chest. Elbows inside knees. Drive through heels.',vid:'dM_Vx1p2wS4'},
      {name:'Incline Dumbbell Press',muscle:'Upper Chest',sets:'3 × 12',rest:'75s',
       tip:'Bench 30-45°, elbows at 45° from body.',vid:'8iP2SOTJ0cY'},
      {name:'Lat Pulldown',muscle:'Lats · Upper Back',sets:'3 × 12',rest:'75s',
       tip:'Slight backward lean. Pull bar to upper chest.',vid:'lueEJGjTuqo'},
      {name:'Dumbbell Shoulder Press',muscle:'Shoulders',sets:'3 × 12',rest:'75s',
       tip:'Neutral grip, press slightly inward at top.',vid:'qE0K6AtA0wM'},
      {name:'Plank Hold',muscle:'Core',sets:'3 × 40s',rest:'45s',
       tip:'Squeeze glutes and abs. Push floor away.',vid:'BQu26ABu1BE'},
    ]
  },
  'upper-body': {
    name:'Upper Body',icon:'💪',
    exercises:[
      {name:'Incline Dumbbell Press',muscle:'Upper Chest',sets:'3 × 12',rest:'75s',
       tip:'Bench 30-45°, elbows 45° from body.',vid:'8iP2SOTJ0cY'},
      {name:'Lat Pulldown',muscle:'Lats',sets:'4 × 12',rest:'75s',
       tip:'Pull to upper chest, full stretch at top.',vid:'lueEJGjTuqo'},
      {name:'Seated Cable Row',muscle:'Mid Back',sets:'3 × 12',rest:'75s',
       tip:'Row to belly button, squeeze 1 sec.',vid:'GZbfasYl4Ik'},
      {name:'Dumbbell Shoulder Press',muscle:'Shoulders',sets:'3 × 12',rest:'75s',
       tip:'Press slightly inward at top.',vid:'qE0K6AtA0wM'},
      {name:'Dumbbell Bicep Curl',muscle:'Biceps',sets:'3 × 12',rest:'60s',
       tip:'Elbow pinned at hip. Slow negative.',vid:'ykJmrZ5v0Oo'},
      {name:'Tricep Rope Pushdown',muscle:'Triceps',sets:'3 × 15',rest:'60s',
       tip:'Elbows pinned. Flare at bottom.',vid:'2-LAM7zBQuA'},
    ]
  },
  'lower-body': {
    name:'Lower Body',icon:'🦵',
    exercises:[
      {name:'Goblet Squat',muscle:'Quads · Glutes',sets:'4 × 12',rest:'90s',
       tip:'Deep squat, elbows inside knees.',vid:'dM_Vx1p2wS4'},
      {name:'Leg Press',muscle:'Quads · Hamstrings',sets:'3 × 15',rest:'90s',
       tip:'Push through heels. Never lock out.',vid:'IZxyjW8sL7E'},
      {name:'Romanian Deadlift',muscle:'Hamstrings · Glutes',sets:'4 × 10',rest:'90s',
       tip:'Push hips back. Bend at waist.',vid:'_dQ3HXSsGrs'},
      {name:'Walking Lunges',muscle:'Quads · Glutes',sets:'3 × 10 each',rest:'75s',
       tip:'Front knee 90°. Keep torso upright.'},
    ]
  },
  'core': {
    name:'Core',icon:'🔥',
    exercises:[
      {name:'Plank Hold',muscle:'Full Core',sets:'3 × 45s',rest:'45s',
       tip:'Push floor away. Squeeze glutes.',vid:'BQu26ABu1BE'},
      {name:'Dead Bug',muscle:'Deep Core',sets:'3 × 10 each',rest:'45s',
       tip:'Lower back flat to floor. Move slow.',vid:'dF3woo27IlI'},
      {name:'Bicycle Crunch',muscle:'Obliques',sets:'3 × 16',rest:'45s',
       tip:'Elbow to opposite knee. Slow twist.'},
      {name:'Russian Twist',muscle:'Obliques',sets:'3 × 12 each',rest:'45s',
       tip:'Feet off ground. Rotate torso.'},
    ]
  }
};
