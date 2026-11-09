package game

import "testing"

type cell struct{ row, col int8 }

// Every set pellet bit in a pellet array, in row-major order
func setPellets(pellets [mazeRows]uint32) []cell {
	var cells []cell
	for row := int8(0); row < mazeRows; row++ {
		for col := int8(0); col < mazeCols; col++ {
			if getBit(pellets[row], col) {
				cells = append(cells, cell{row, col})
			}
		}
	}
	return cells
}

func abs8(x int8) int8 {
	if x < 0 {
		return -x
	}
	return x
}

func TestClearAllButNearestPelletKeepsClosest(t *testing.T) {
	gs := newGameState()
	gs.pacmanLoc.row, gs.pacmanLoc.col = 23, 13
	scoreBefore := gs.getScore()

	// Expected: the first pellet (row-major) with the smallest Manhattan distance
	var want cell
	best := int8(-1)
	for _, c := range setPellets(initPellets) {
		d := abs8(c.row-23) + abs8(c.col-13)
		if best < 0 || d < best {
			best, want = d, c
		}
	}

	gs.clearAllButNearestPellet()

	if n := gs.getNumPellets(); n != 1 {
		t.Fatalf("numPellets = %d, want 1", n)
	}
	got := setPellets(gs.pellets)
	if len(got) != 1 || got[0] != want {
		t.Fatalf("remaining pellets = %v, want [%v]", got, want)
	}
	if gs.getScore() != scoreBefore {
		t.Fatalf("score changed from %d to %d", scoreBefore, gs.getScore())
	}
}

func TestClearAllButNearestPelletOffBoardUsesFirstRowMajor(t *testing.T) {
	gs := newGameState()
	gs.pacmanLoc.row = 32

	gs.clearAllButNearestPellet()

	got := setPellets(gs.pellets)
	want := setPellets(initPellets)[0]
	if len(got) != 1 || got[0] != want {
		t.Fatalf("remaining pellets = %v, want [%v]", got, want)
	}
}

func TestClearAllButNearestPelletNoPelletsIsNoop(t *testing.T) {
	gs := newGameState()
	gs.pellets = [mazeRows]uint32{}
	gs.numPellets = 0

	gs.clearAllButNearestPellet()

	if n := gs.getNumPellets(); n != 0 {
		t.Fatalf("numPellets = %d, want 0", n)
	}
	if got := setPellets(gs.pellets); len(got) != 0 {
		t.Fatalf("pellets appeared: %v", got)
	}
}

func TestInterpretCommandC(t *testing.T) {
	gs := newGameState()

	if restart := gs.interpretCommand([]byte{'c'}); restart {
		t.Fatal("interpretCommand('c') requested a restart")
	}
	if n := gs.getNumPellets(); n != 1 {
		t.Fatalf("numPellets = %d, want 1", n)
	}
}
