// Per-forest no-cut setback distances (feet). verified:true = stated on the cited official permit/rules page (2025 season).
// verified:false = NOT stated in any source we found -> conservative app DEFAULT (150 ft unless noted). Always follow your permit.
// keys: paved (paved roads & highways), fsroad (any Forest/unpaved road), rec (campgrounds, picnic areas, trailheads, developed rec sites),
//       trail, stream (perennial streams / riparian). Features with no data in the app are listed in `nodata`.
window.SETBACKS = {
 lincoln: {
  paved:{ft:100,verified:true,src:"https://www.ruidoso-nm.gov/news-info/christmas-tree-cutting-permits",note:"“within 100 feet of a paved road”"},
  fsroad:{ft:150,verified:false,note:"No setback stated for unpaved Forest roads – conservative default (lower in Settings if your permit allows)"},
  rec:{ft:300,verified:true,src:"https://www.ruidoso-nm.gov/news-info/christmas-tree-cutting-permits",note:"“within 300 feet of a recreation site (campgrounds, developed trails, etc.)”"},
  trail:{ft:300,verified:true,src:"https://www.ruidoso-nm.gov/news-info/christmas-tree-cutting-permits",note:"Developed trails are listed with recreation sites (300 ft)"},
  stream:{ft:150,verified:false,note:"Not stated – conservative default"}},
 santafe: {
  paved:{ft:150,verified:false,note:"Not stated – default"},fsroad:{ft:150,verified:false,note:"Not stated – default"},
  rec:{ft:150,verified:false,note:"Not stated – default"},trail:{ft:150,verified:false,note:"Not stated – default"},stream:{ft:150,verified:false,note:"Not stated – default"}},
 carson: {
  paved:{ft:100,verified:true,src:"https://www.recreation.gov/tree-permits/c9f6b1b9-ebb7-11ea-98dd-e638fec87f2e",note:"100 ft of any State Highway"},
  fsroad:{ft:100,verified:true,src:"https://www.recreation.gov/tree-permits/c9f6b1b9-ebb7-11ea-98dd-e638fec87f2e",note:"100 ft of any Forest Road"},
  rec:{ft:100,verified:true,src:"https://www.recreation.gov/tree-permits/c9f6b1b9-ebb7-11ea-98dd-e638fec87f2e",note:"100 ft of any campground (and no cutting in designated campgrounds)"},
  trail:{ft:100,verified:true,src:"https://www.recreation.gov/tree-permits/c9f6b1b9-ebb7-11ea-98dd-e638fec87f2e",note:"100 ft of any trail"},
  stream:{ft:100,verified:true,src:"https://www.recreation.gov/tree-permits/c9f6b1b9-ebb7-11ea-98dd-e638fec87f2e",note:"100 ft of any stream or river"}},
 cibola: {
  paved:{ft:150,verified:false,note:"Permit says no cutting “along roadways” – no distance given; default"},
  fsroad:{ft:150,verified:false,note:"“along roadways” – no distance given; default"},
  rec:{ft:150,verified:false,note:"No cutting in recreation sites incl. picnic areas & trailheads – no buffer given; default"},
  trail:{ft:150,verified:false,note:"Not stated – default"},stream:{ft:150,verified:false,note:"Not stated – default"}},
 blm: {
  paved:{ft:150,verified:false,note:"Not stated – default"},fsroad:{ft:150,verified:false,note:"Not stated – default"},rec:{ft:150,verified:false,note:"Not stated – default"},trail:{ft:150,verified:false,note:"Not stated – default"},stream:{ft:150,verified:false,note:"Not stated – default"}},
 gila: {
  paved:{ft:200,verified:true,src:"https://www.recreation.gov/tree-permits/4271ccea-ebb8-11ea-895c-7e0f799b6940",note:"200 ft of paved roads"},
  fsroad:{ft:150,verified:false,note:"Not stated for unpaved roads – conservative default"},
  rec:{ft:200,verified:true,src:"https://www.recreation.gov/tree-permits/4271ccea-ebb8-11ea-895c-7e0f799b6940",note:"200 ft of developed recreation sites"},
  trail:{ft:150,verified:false,note:"Not stated – default"},
  stream:{ft:150,verified:false,note:"Riparian (river and stream) areas are closed – width not given; default 150 ft"}}
};
window.SETBACK_LABELS={paved:"Paved roads / highways",fsroad:"Unpaved Forest roads",rec:"Campgrounds, picnic areas, trailheads, rec sites",trail:"Trails",stream:"Perennial streams / riparian"};
window.SETBACK_NODATA=["Residences / private structures (not mapped – private land itself is masked)","Power lines","Tree plantations & active timber sales (not mapped)","Lakes/ponds (only perennial NHD streams are mapped)","Current closure-order polygons (only published as PDF maps)"];
