var renderer, scene, camera, raycaster, meshes = [];
var mouse = new THREE.Vector2();

var counties = d3.map();

// transormation matrix
var positioning;

var RO_CENTER = [25.0094303, 45.9442858];
var MAX_EXTRUSION = 10;

var years = [], currentYear;

var numberFormatter = d3.format('0,000');

// function that maps population int to extrusion value
// requires the maximum possible population
var getExtrusion;

// function that maps population int to luminance
// requires the maximum possible population
var getLuminance;

function initRenderer() {
	renderer = new THREE.WebGLRenderer();

	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setClearColor(0x000000);

	document.body.appendChild(renderer.domElement);
}

function initThree() {
	initRenderer();

	raycaster = new THREE.Raycaster();

	scene = new THREE.Scene();

	initCamera();
	initLights();

	controls = new THREE.TrackballControls(camera, renderer.domElement);
	controls.minDistance = 10;
	controls.maxDistance = 50;

	animate();
}

function initCamera() {
	camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 10000);
	camera.position.set(-8.278324114488553, 23.715105536749885, 5.334970045945842);
	camera.up.set(-0.3079731382492934, 0.9436692395156481, -0.12099963846565401);

	// restoreCameraOrientation(camera);
}

function initLights() {
	var pointLight = new THREE.PointLight(0xFFFFFF);
	pointLight.position.set(-800, 800, 800);
	scene.add(pointLight);

	var pointLight2 = new THREE.PointLight(0xFFFFFF);
	pointLight2.position.set(800, 800, 800);
	scene.add(pointLight2);

	var pointLight3 = new THREE.PointLight(0xFFFFFF);
	pointLight3.position.set(0, 800, -800);
	scene.add(pointLight3);
}

function initLine() {
    var material = new THREE.LineBasicMaterial({
        color: 0x0000ff
    });

	var geometry = new THREE.Geometry();
	geometry.vertices.push(
		new THREE.Vector3( 0, 0, 0 ),
		new THREE.Vector3( 0, 100, 0 )
	);

	var line = new THREE.Line( geometry, material );
	scene.add( line );
}

function updateInfoBox() {
	raycaster.setFromCamera( mouse, camera );

	var intersects = raycaster.intersectObjects(scene.children);

	var html = '';

	for (var i=0; i<intersects.length; i++) {
		var countyCode = intersects[i].object.userData.countyCode;
		if (countyCode) {
			var county = counties.get(countyCode);
			var population = county.get(currentYear); 
			html = county.get('name') + ': ' + numberFormatter(population);
			break;
		}
	}

	document.getElementById('infobox').innerHTML = html;
}

function animate() {
	controls.update();
	renderer.render(scene, camera);
	updateInfoBox();

	requestAnimationFrame(animate);
}

function onDocumentMouseMove( event ) {
	mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
	mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;
}

function onWindowResize() {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	renderer.setSize(window.innerWidth, window.innerHeight);
}


function cameraIter(callback) {
	['position', 'up'].forEach(callback);
}

function saveCameraOrientation() {
	cameraIter(function (key) {
		sessionStorage.setItem('camera.' + key, JSON.stringify(camera[key].toArray()));
	});
}

function restoreCameraOrientation() {
	cameraIter(function (key) {
		var val = JSON.parse(sessionStorage.getItem('camera.' + key));
		if (val) {
			camera[key].fromArray(val);
		}
	});
}


function initGeometry(features) {
	var path = d3.geo.path().projection(d3.geo.mercator().center(RO_CENTER));

	features.forEach(function(feature) {
		if (feature.id === 'IF') {
			// remove Bucharest hole
			feature.geometry.coordinates = feature.geometry.coordinates.slice(0, 1);
		}

		var contour = transformSVGPath(path(feature));

		var county = counties.get(feature.id);
		county.set('contour', contour);
		county.set('name', feature.properties.name);
	});
}

function initPositioningTransform() {
	positioning = new THREE.Matrix4();

	var tmp = new THREE.Matrix4();
	positioning.multiply(tmp.makeRotationX(Math.PI/2));
	positioning.multiply(tmp.makeTranslation(-480, -250, 0));
}

function updateMeshes(year) {
	// remove curren meshes
	meshes.forEach(function(mesh) {
		scene.remove(mesh);
	});

	meshes = counties.entries().map(function(entry) {
		var countyCode = entry.key, county = entry.value;
		var population = county.get(year);
		var extrusion = getExtrusion(population);
		var luminance = getLuminance(population);
		var color = d3.hsl(105, 0.8, luminance).toString();

		var extrudeMaterial = new THREE.MeshLambertMaterial({color: color}); 
		var faceMaterial = new THREE.MeshBasicMaterial({color: color});

		var geometry = county.get('contour').extrude({
			amount: extrusion,
			bevelEnabled: false,
			extrudeMaterial: 0,
			material: 1
		});

		var mesh = new THREE.Mesh(geometry, new THREE.MeshFaceMaterial(
			[extrudeMaterial, faceMaterial]));

		mesh.userData.countyCode = countyCode;

		mesh.applyMatrix(positioning);
		mesh.translateZ(-extrusion);

		scene.add(mesh);

		return mesh;
	});
}

// concurrently load multiple data sources; the callback will be invoked when everything is loaded
function loadData(sources, callback) {
	var remaining = sources.length;
	var results = {}

	sources.forEach(function(source) {
		function handler(error, data) {
			if (error) throw error;

			results[source.key] = data;

			remaining--;

			if (!remaining) {
				callback(results);
			}
		}

		args = source.args.slice();
		args.push(handler);
		d3[source.type].apply(d3, args);
	});
}

var dataSources = [
	{type: 'json', args: ['data/romania-topo.json'], key: 'judete'},
	{type: 'json', args: ['data/judete-id.json'], key: 'id_judete'},
	{type: 'csv', args: ['data/recensaminte.csv'], key: 'recensaminte'}
];

function extractYears(recensaminte) {
	return Object.keys(recensaminte[0]).filter(function(key) {
		return key !== 'name';
	}).map(function(year) {
		return parseInt(year, 10);
	});
}

function prepareCensusData(recensaminte, id_judete) {
	var max_population = 0;
	var year_sums = {};

	recensaminte.forEach(function(row) {
		var countyCode = id_judete[row.name];

		var datum = d3.map();

		years.forEach(function(year) {
			var value = parseInt(row[year], 10);

			datum.set(year, value);

			if (value > max_population) {
				max_population = value;
			}
		});

		counties.set(countyCode, datum);
	});

	return max_population;
}

initThree();
initPositioningTransform();
// initLine();

var YearButtons = React.createClass({
	getYearFromHash: function() {
		var re = new RegExp('#/an/(\\d{4})');
		var match = window.location.hash.match(re);
		var currentYear;

		if (match) {
			currentYear = +match[1];
			if (this.props.years.indexOf(currentYear) > -1) {
				return currentYear;
			}
		}

		return false;
	},

	getInitialState: function() {
		var currentYear = this.getYearFromHash();

		if (!currentYear) {
			currentYear = this.props.years[0];
		}

		return {currentYear: currentYear};
	},

	componentDidMount: function() {
		window.addEventListener('hashchange', this.onHashChange);
	},

	componentWillUnmount: function() {
		window.removeEventListener('hashchange', this.onHashChange);
	},

	onHashChange: function(year) {
		var year = this.getYearFromHash();

		if (year) {
			this.setState({currentYear: year});
		}
	},

	render: function() {
		var self = this;

		currentYear = self.state.currentYear;  // used by infobox
		updateMeshes(this.state.currentYear);

		function createButton(year) {
			var classes = classNames({
				'btn': true,
				'btn-default': true,
				'active': year == self.state.currentYear
			});

			return <a className={classes} key={year} href={'#/an/' + year}>{year}</a>;
		}

		return <div id="current-year" className="btn-group" role="group">{self.props.years.map(createButton)}</div>;
	}
});

loadData(dataSources, function(results) {
	years = extractYears(results.recensaminte);
	var max_population = prepareCensusData(results.recensaminte, results.id_judete);

	getExtrusion = d3.scale.linear().domain([0, max_population]).range([0, MAX_EXTRUSION]);
	getLuminance = d3.scale.linear().domain([0, max_population]);

	var judete = results.judete;

	var features = topojson.feature(judete, judete.objects['romania-counties-geojson']).features;
	initGeometry(features);

	React.render(<YearButtons years={years} />, document.getElementById('container'));
});

document.addEventListener('mousemove', onDocumentMouseMove);
window.addEventListener('resize', onWindowResize);
window.addEventListener('beforeunload', saveCameraOrientation);
